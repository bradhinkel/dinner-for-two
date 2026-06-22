# Dinner for Two

A mobile-first web app that turns a short natural-language brief — *"moderately priced
Italian, romantic, we like to share courses"* — into **three deliberately different
complete evenings** (dependable / adventurous / wildcard): restaurant + composed
multi-course meal + beverage pairing + a short rationale, for a curated set of Seattle
restaurants. The differentiator is a *curated spread of three*, not a ranked list, and
full-evening composition, not dish lookup.

**Status:** Phases 0–2 complete. Headless engine + web UI both built and running; a
restaurant-import pipeline scaled the catalog to **78 restaurants (61 active)**. See
`CLAUDE.md` for the live build status and `docs/project_plan.md` for the full spec.

## Pipeline (brief → spread)

```
brief ──parse(Haiku)──▶ structured fields
      ──retrieve──────▶ hard filter → Voyage cosine → candidate pool → MMR select 3 + roles
      ──compose(Sonnet)▶ 3× parallel, routed on venue_format AND menu_completeness,
                         dish-ID validated (reject+retry, then tier fallback)
      ──────────────────▶ Spread JSON (3 evenings)
```

Only the 3 final candidates are ever composed — never the catalog. Data layer is
**in-memory** at MVP scale (project_plan §8): the catalog + precomputed embeddings are
checked-in JSON; filter + cosine + MMR run in TS behind the `Retriever` interface in
`src/retrieval/` (so the Phase 4 Postgres+pgvector swap is contained). Retrieval serves
only rooms with `curation:"use"` and excludes `CLOSED_*` (Places-flagged) venues.

## Setup

```bash
npm install
cp .env.example .env.local      # then add your keys:
#   ANTHROPIC_API_KEY     — Haiku (parse) + Sonnet (compose)
#   VOYAGE_API_KEY        — description embeddings (voyage-4-lite); build-time only
#   GOOGLE_PLACES_API_KEY — geo + closure signal for the import pipeline; pipeline-time only
```

The runtime web server only needs `ANTHROPIC_API_KEY` — `data/restaurants.json` and
`data/embeddings.json` are precomputed and checked in.

## Run

**Web app** — the product; mobile-first UI (390px shell):

```bash
npm run dev            # http://localhost:3000
# Brief → 3 evening cards reveal together → rationale streams into each →
# menu fills last. Course swap, "different room" regenerate, and share links work.
npm run build && npm start   # production build
```

**Headless engine** — the same brain, on the CLI, no UI:

```bash
npm run engine -- "moderately priced Italian, romantic, we like to share courses"
npm run engine -- "anniversary, upscale seafood, oysters" --json   # JSON only
```

### Screens & API (two-call model, project_plan §7)

- `01 Brief` → `POST /api/retrieve` (parse + retrieve, ~1–2s) → 3 headers + roles + brief lines.
- Results → `POST /api/compose/:restaurant_id` ×3 (SSE) → rationale streams, then validated courses/pairing/total.
- `POST /api/swap-course` · `POST /api/regenerate-evening` · `POST /api/share` → `GET /e/:token` (read-only, 6h TTL).
- Design tokens + voice from `docs/Screen Handoff.html` (paper/ink/oxblood, italic Cormorant). Hero photography is gradient-placeholder until assets exist.

## Restaurant import pipeline

Scales the curated catalog from a raw Seattle discovery list. Four stages, all in `src/pipeline/`:

```bash
npm run liveness                      # Stage 1: probe the raw list → data/worklist.json (live/blocked/pdf/dead…)
npm run ingest -- "Name" | --state blocked | --url <pdf>   # Stage 2/3: Playwright render (+ Cloudflare/SPA
                                      #   defeat, deep menu-link follow) + PDF extract → Claude → menu/<slug>.json
npm run enrich -- [slugs]             # Stage 4: Google Places (geo + closure + price) + LLM attrs → import_attributes.json
npm run build:catalog && npm run build:embeddings   # rebuild the in-memory catalog + Voyage embeddings
python3 scripts/catalog_review.py     # → menu/catalog-review.html (sortable active/chain/closed review)
```

Render path needs Playwright Chromium (`npx playwright install chromium`) + host libs
`libnss3 libnspr4 libasound2t64`. Known capability gap: image / scanned-PDF menus need a
vision-OCR pass (not built). See `CLAUDE.md` for ingest details and the curation model.

## Deploy

Low-traffic single-droplet target — see `deploy/DEPLOY.md` and `deploy/nginx.conf.example`.
Key constraints: run **one** Node process (the spread/share store is in-memory, not shared
across workers), Nginx with `proxy_buffering off` on `/api/compose/` (SSE), and an
outbound-LLM concurrency gate + retry in `src/llm/anthropic.ts` (`LLM_MAX_CONCURRENCY`,
`LLM_MAX_RETRIES`) so a burst doesn't trip the Anthropic rate tier.

## Check without API keys

```bash
npm run typecheck                   # tsc --noEmit
npx tsx scripts/smoke.ts            # retrieval core offline (fake embeddings): filter+cosine+MMR+roles
```

## Layout

| Path | What |
|---|---|
| `src/app/` | Next.js App Router — pages + `/api/*` routes (Phase 2 web UI) |
| `src/parse/` | Haiku brief → `ParsedBrief` |
| `src/retrieval/` | `Retriever` interface + in-memory filter/cosine/MMR/roles |
| `src/embeddings/` | Voyage client + precompute + runtime store |
| `src/compose/`, `src/server/` | Sonnet composer (tier routing + dish-ID validation); streaming variant |
| `src/llm/` | shared Anthropic client + concurrency gate / retry |
| `src/pipeline/` | import pipeline: liveness, fetchMenu (render/PDF), extractMenu, enrich, places |
| `src/catalog/` | merge seed + `import_attributes.json` + `menu/*.json` → `data/restaurants.json` |
| `data/` | generated, checked-in: `seed_attributes.json`, `import_attributes.json`, `restaurants.json`, `embeddings.json` |
| `menu/*.json` | structured restaurant menus (78) |
| `deploy/` | droplet deploy notes + nginx example |

## Tunables (`.env.local`, defaults in `src/config.ts`)

`MMR_LAMBDA` (0.7) relevance↔diversity · `CANDIDATE_POOL` (24) · `RELEVANCE_FLOOR` (0) ·
`PARSE_MODEL` · `COMPOSE_MODEL` · `VOYAGE_MODEL` · `LLM_MAX_CONCURRENCY` (8) · `LLM_MAX_RETRIES` (4).
