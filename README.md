# Dinner for Two — Phase 1 engine

Headless engine that turns a natural-language date-night brief into **three deliberately
different complete evenings** (dependable / adventurous / wildcard) for a curated set of
Seattle restaurants. No UI yet — that's Phase 2. See `CLAUDE.md` and `docs/project_plan.md`
for the full plan; `menu/PHASE0_READINESS.md` for the data status.

## Pipeline

```
brief ──parse(Haiku)──▶ structured fields
      ──retrieve──────▶ hard filter → Voyage cosine → candidate pool → MMR select 3 + roles
      ──compose(Sonnet)▶ 3× parallel, routed on venue_format AND menu_completeness,
                         dish-ID validated (reject+retry, then tier fallback)
      ──────────────────▶ Spread JSON (3 evenings)
```

Data layer is **in-memory** at MVP scale (project_plan §8): the catalog + precomputed
embeddings are checked-in JSON; filter + cosine + MMR run in TS behind the `Retriever`
interface in `src/retrieval/` (so the Phase 4 Postgres+pgvector swap is contained).

## Setup

```bash
npm install
cp .env.example .env.local      # then add your keys:
#   ANTHROPIC_API_KEY  — Haiku (parse) + Sonnet (compose)
#   VOYAGE_API_KEY     — description embeddings (dash.voyageai.com; voyage-4-lite, free tier)
```

## Build the data (one-time; outputs are checked in)

```bash
python3 scripts/extract_seed.py     # Excel seed attrs  -> data/seed_attributes.json
npm run build:catalog               # merge w/ menu/*.json -> data/restaurants.json
npm run build:embeddings            # Voyage embeddings  -> data/embeddings.json  (needs VOYAGE_API_KEY)
```

## Run

**Web app (Phase 2)** — mobile-first UI on the engine:

```bash
npm run dev            # http://localhost:3000 (390px shell)
# Brief → 3 evening cards reveal together → rationale streams into each →
# menu fills last. Course swap, "different room" regenerate, and share links work.
npm run build && npm start   # production build
```

**Headless engine (Phase 1)** — CLI, no UI:

```bash
npm run engine -- "moderately priced Italian, romantic, we like to share courses"
# human-readable summary on stderr, full Spread JSON on stdout
npm run engine -- "anniversary, upscale seafood, oysters" --json   # JSON only
```

### Screens & API (two-call model, project_plan §7)

- `01 Brief` → `POST /api/retrieve` (parse + retrieve, ~1-2s) → 3 headers + roles + brief lines.
- Results → `POST /api/compose/:restaurant_id` ×3 (SSE) → rationale streams, then validated courses/pairing/total.
- `POST /api/swap-course` · `POST /api/regenerate-evening` · `POST /api/share` → `GET /e/:token` (read-only, 6h TTL).
- Design tokens + voice from `docs/Screen Handoff.html` (paper/ink/oxblood, italic Cormorant). Hero photography is gradient-placeholder until assets exist.

## Check without API keys

```bash
npm run typecheck                   # tsc --noEmit
npx tsx scripts/smoke.ts            # retrieval core offline (fake embeddings): filter+cosine+MMR+roles
```

## Layout

| Path | What |
|---|---|
| `src/parse/` | Haiku brief → `ParsedBrief` |
| `src/retrieval/` | `Retriever` interface + in-memory filter/cosine/MMR/roles |
| `src/embeddings/` | Voyage client + precompute + runtime store |
| `src/compose/` | Sonnet composer, tier routing + dish-ID validation |
| `src/catalog/` | merge Excel seed + `menu/*.json` → `data/restaurants.json` |
| `src/engine.ts`, `src/cli.ts` | orchestration + CLI |
| `data/` | generated, checked-in: `seed_attributes.json`, `restaurants.json`, `embeddings.json` |
| `menu/*.json` | 19 structured restaurant menus (Phase 0) |

## Tunables (`.env.local`, defaults in `src/config.ts`)

`MMR_LAMBDA` (0.7) relevance↔diversity · `CANDIDATE_POOL` (24) · `RELEVANCE_FLOOR` (0) ·
`PARSE_MODEL` · `COMPOSE_MODEL` · `VOYAGE_MODEL`.
