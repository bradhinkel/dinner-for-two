# Deploying Dinner for Two on a DigitalOcean droplet

Low-traffic target (~10 users). A 1 vCPU / 1–2 GB droplet is plenty — the app is
I/O-bound (it spends almost all its time waiting on the Anthropic API, not
computing). The notes below are the few things that actually matter at this scale.

## 1. Run exactly ONE Node process

Spreads and share links live in an **in-memory store** (`src/server/store.ts`) — a
`Map`, not a database. Consequences:

- **Do NOT use PM2 cluster mode or multiple replicas.** A spread created on one
  worker is invisible to another, so compose/swap/regenerate would 404 randomly.
  One process is plenty for 10 users.
- **A restart or redeploy wipes all spreads and share links** (shares have a 6h TTL
  but only in memory). A `/e/:token` link breaks after you redeploy. If share links
  must survive restarts, swap the `Map` for SQLite or Redis — it's already behind
  the `store` interface, so it's a contained change. Not needed for launch.

```bash
npm ci
npm run build
# foreground:
npm start                       # next start, defaults to :3000
# or single-process PM2 (NOT cluster mode):
pm2 start "npm start" --name dft
```

Build needs ~1 GB free RAM; on a 1 GB droplet add swap first (`fallocate -l 2G
/swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`) or build
elsewhere and ship `.next`.

## 2. Nginx in front for TLS + SSE

Use `deploy/nginx.conf.example`. The one non-obvious requirement: **`proxy_buffering
off` on the `/api/compose/` route** — otherwise the streamed rationale is buffered
and the UI looks frozen for ~5s. (The app also sends `X-Accel-Buffering: no` on that
response as a backstop.) Then `certbot --nginx -d your.domain` for TLS.

## 3. Environment (`.env.local`, never committed)

```
ANTHROPIC_API_KEY=...
VOYAGE_API_KEY=...            # only used at build time (build:embeddings); not needed at runtime
GOOGLE_PLACES_API_KEY=...     # only used by the import/enrich pipeline; not needed at runtime
# Optional outbound-LLM tuning (sane defaults; no redeploy needed to change):
# LLM_MAX_CONCURRENCY=8       # max simultaneous Anthropic calls before queuing
# LLM_MAX_RETRIES=4           # transient-error (429/529/5xx) retry attempts
```

Note: `data/restaurants.json` + `data/embeddings.json` are precomputed and checked
in, so the **runtime** server only needs `ANTHROPIC_API_KEY`. Voyage/Places keys are
build-/pipeline-time only.

## 4. Capacity reality check

The server is not the bottleneck — the Anthropic API is. One "generate" = 1 Haiku
parse + 3 Sonnet compose streams, so a simultaneous burst of N users puts up to
~4·N calls in flight. The **concurrency gate in `src/llm/anthropic.ts`** caps that
at `LLM_MAX_CONCURRENCY` (default 8) so a burst queues instead of tripping your
Anthropic rate/concurrency tier (429); `withRetry` rides out transient 429/529/5xx
with backoff. At 10 users the worst case is a couple extra seconds of queueing
during a simultaneous burst — fine. If you ever see sustained queueing, raise
`LLM_MAX_CONCURRENCY` (and confirm your Anthropic usage tier allows it).
