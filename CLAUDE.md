# Dinner for Two — Build Guide (CLAUDE.md)

Read this first. It orients you, pins the decisions that aren't obvious from the code, and gives you the contracts and prompts to start Phase 1. When this file and another doc disagree, **this file and `project_plan.md` win**.

## ⏯ Current status — resume here (updated 2026-06-22)

**Phases 0–2 are done and merged to `main`. Restaurant import is in progress on branch `import-seattle` (not yet merged).** Day-to-day progress + decisions are also in agent memory (`MEMORY.md`).

- **Phase 0 (data) ✓** — structured `menu/*.json` + error taxonomy/tier rules. See `menu/PHASE0_READINESS.md`.
- **Phase 1 (headless engine) ✓** — `parse → retrieve (in-memory hard filter + Voyage cosine + MMR + roles, behind a `Retriever` interface) → compose (Sonnet, routed on venue_format + menu_completeness, dish-ID validated)`. Run: `npm run engine -- "brief"`.
- **Phase 2 (web UI) ✓** — Next.js App Router + Tailwind + PWA; two-call model (`/api/retrieve` fast headers, SSE `/api/compose/:id` streamed); brief → 3-card spread → swap / regenerate / share. Tokens from `Screen Handoff.html`. Run: `npm run dev`.
- **Import pipeline (in progress, branch `import-seattle`)** — four stages, all built and working:
  - `npm run liveness` — Stage 1 gate over `docs/Raw Restaurant List.txt` (Seattle, 297 unique) → `data/worklist.json` with live/blocked/live-js/pdf/dead/redirected classifications (**216 viable & new**).
  - `npm run ingest -- "Name" …` — Stage 2/3 acquisition: Playwright headless render (defeats Cloudflare/JS; follows hub→dinner-menu up to 2 hops) **+** PDF text extraction (`unpdf`), then a Claude call structures it → `menu/<slug>.json`. Flags: `--state <bucket>` (e.g. `blocked`, `live-js`), `--url <pdf>` (override a worklist URL).
  - `npm run enrich -- <slug> …` (no args = all un-enriched imports) — Stage 4: Google Places (lat/long + `business_status` closure signal + price) **+** LLM attributes (price_tier, vibe_tags, date_night_score, dietary, product-voice description) → `data/import_attributes.json`.
  - `npm run build:catalog && npm run build:embeddings` — rebuild the in-memory catalog + Voyage embeddings.

**Catalog: 78 restaurants, 61 active** (from 19 → 32 → 77 → 78; 72 with dishes, ~2,165 dishes). 5 are `CLOSED_PERMANENTLY` (Places-flagged, auto-suppressed) and 12 are `curation:"hide"` (curated-out chains, below); **retrieval serves the 61 active**. Data model carries `curation` (`use`/`hide`), `latitude`/`longitude`, `business_status`.

The full scale batch (blocked + live-js + **live**, 2026-06-22) is **done**: ingested → enriched → rebuilt → engine smoke-tested green. Yield: blocked ~31%, live-js ~0%, live ~40% (the bulk). Two ingest bugs fixed: per-room try/catch in `ingest.ts` (one malformed/truncated LLM response was aborting whole batches) and extract `max_tokens` 8000→16000 + truncation guard in `extractMenu.ts` (Barking Dog's 66 dishes were silently truncating to invalid JSON). Cleanup: deleted all `none-accessible` 0-dish failures (they'd pollute the catalog AND block re-ingest, since ingest skips any existing `menu/<slug>.json`) and all `(duplicate removed)` artifacts; deduped same-venue slug variants.

**Curation pass done** (`curation:"hide"` in `import_attributes.json`): collapsed casual chains to one rep each + hid dns2 misfits — Tutta Bella ×3, Mioposto ×2, Cedars ×2, Matador ×2, Masonry ×2, plus Barking Dog. Reversible. **`fetchMenu` SPA/deep-follow rewrite done + validated**: content-aware hydration wait (replaces fixed 4s), multi-candidate ranked follow reusing one browser, in-page menu-tab reveal, smarter link scoring (boost Toast/Popmenu, penalize social/reservation), `looksLikeMenu` price bar 6→8 (stops gift/merch-shop homepages from false-positiving and short-circuiting the follow). **Recovered Six Seven (53 dishes, dns5)** — its menu was buried in the Edgewater hotel `/dine` hub, the exact deep-nav case.

### ▶ NEXT STEPS (toward the Phase 3 "100 solid" gate — at 61 active now)

1. **Remaining straggler failures are NOT deep-follow bugs** (the rewrite handles nav depth — Six Seven proves it). They split into two unbuilt-capability buckets: **(a) image menus** — Il Terrazzo Carmine has a clean `/dinner-menu…` page but it's an image (renders only hours/contact); the live-js "0 dishes" rooms (Anar, Pomerol, Lupo, The Blue Glass) are likely the same → need a **vision-OCR pass** (not built). **(b) bot-blocked / empty shells** — the live-js "no usable content" rooms (Mr. Gyros ×4, Cafe Turko, Pasta Freska, Eve Fremont, Bitterroot) serve <200 chars to headless Chromium → need stealth/non-headless or are image one-pagers; all low-value casual spots anyway. **Daniel's Broiler** = hostile multi-hop Shopify (menu 3+ hops past a `/pages/locations` hub) → hand-feed `--url <menu-or-pdf>`. **Cafe Munir** → drop (off-domain redirect).
2. To grow past 61 toward 100: the highest-leverage *new* capability is now a **vision-OCR extraction path** for image/scanned-PDF menus (a Claude vision call on a screenshot / `pdf-scanned` page), since the deep-follow lever is spent. Otherwise keep mining the unworked viable pool with the improved renderer.

Pacing: a ~30-room batch ≈ 10–15 min of rendering + ~30 Claude extraction calls — run a batch, review, continue. The new hydration wait makes each render slower but recovers deeper menus.

**Env required** (`.env.local`, gitignored): `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `GOOGLE_PLACES_API_KEY` (enable "Places API (New)"). Headless render needs Playwright Chromium (`npx playwright install chromium`) + host libs `libnss3 libnspr4 libasound2t64` — on Ubuntu 24.04 install via `sudo apt-get install -y …` **in a real terminal** (the Claude Code `!` prefix has no TTY, so `sudo` can't read a password there).

## What this is

A mobile-first web app that turns a short natural-language brief ("moderately priced Italian, romantic, we like to share courses") into **three deliberately different complete evenings** — restaurant + composed multi-course meal + beverage pairing + a short rationale — for a curated set of Seattle restaurants. The differentiator is a *curated spread of three* (dependable / adventurous / wildcard), not a ranked list, and full-evening composition, not dish lookup.

## Documents, and the order to read them

1. **`CLAUDE.md`** (this file) — build orientation, stack, scope, contracts, prompts.
2. **`project_plan.md`** — the implementation spec and source of truth: data model (§2), retrieval (§3), composer (§4), validation (§5), API surface (§7), 7-phase plan (§8).
3. **`Dinner_for_Two_Project_Plan_v2.docx`** — product rationale (the "why"). Background, not implementation.
4. **`Restaurant_Finder_Process.md`** — discovery → verification → ingestion process (Phase 4/5 build; ops in Phase 6).
5. **`Screen Handoff.html`** — UX/screen spec; build the Phase 2 UI against this.
6. **`Seattle_Restaurants_Enriched.xlsx`** + **`Seattle Restaurants.txt`** — seed data (the import) and the URL list.
7. **`menu/*.json`** — worked examples of the extraction target schema. **`menu/triage-report.html`** + **`menu/menu-review.html`** — current data status.

Ignore: `Project Plan.html` (stale April render — superseded by `project_plan.md`), `Dinner for Two.html` (broken — missing JS assets), any `*_v1*` / lock files.

## Stack — pinned decisions (don't re-litigate)

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind; PWA manifest.
- **LLM:** Anthropic — Haiku for brief parse, Sonnet for composition. API key via env (`ANTHROPIC_API_KEY`), never committed.
- **Data layer — in-memory at MVP scale.** At ~90 rows do NOT stand up Postgres/pgvector. Load the enriched seed on boot, precompute the description embeddings once and check them into the repo as JSON, and run hard filters + cosine + MMR **in JS/TS, behind a `retrieval` module**. The DB swap (Postgres + pgvector) is a Phase 4 concern; keep retrieval behind an interface so it's a contained change.
- **Bounded LLM cost:** only the 3 final candidates are ever composed — never the catalog.

## Phase 1 scope (build this first — headless engine, no UI)

Prove the brain before the face. Deliverable: a CLI/script where **brief in → 3 distinct, genuinely good evenings out**, as JSON.

1. `parse(brief)` — Haiku → structured fields.
2. `retrieve(parsed)` — hard filter → cosine over in-memory embeddings → candidate pool (~20–40) → MMR select 3 + assign spread roles.
3. `compose(restaurant, parsed)` — Sonnet, routed on `venue_format` AND `menu_completeness` (see below); dish-ID validated.

Tune MMR `λ` and iterate prompts here. No screens yet (that's Phase 2).

## Out of scope for the whole MVP

User accounts/history/personalization; native apps; multi-city; reservations/payment/booking; social/ratings; group dining (3+); real-time menu scanning/OCR at unknown restaurants; the production database (Phase 4); the discovery/ingestion pipeline (Phase 4/5). Don't build these; don't stub elaborate hooks for them.

## Composition: route on venue_format AND menu_completeness

Most viable restaurants do **not** have a clean full menu. Treat `menu_completeness` as a first-class tier:

- **`full`** — dish-ID-validated menu → compose the full evening (4-course or two-entree per the ordering model).
- **`partial`** — some dishes known → compose at dish level where IDs validate; narrate the rest at category level; flag freshness.
- **`experience-only`** — no reliable dish data (tasting-only, image-not-yet-extracted, no menu) → **experience-led mode**: sell the room, occasion fit, and a known signature/pairing; make **zero** unverifiable dish claims. This is a primary path, not an error state.

Guardrails (all tiers): real items only, validated by dish ID (reject + retry on hallucination); respect dietary constraints; dinner stays the spine; appeal floor — drop to recommendation mode rather than force a template.

## API contracts (two-call progressive model)

Reveal: all three header cards appear together the instant call 1 returns (~1–2s P50); rationale then streams into all three in parallel; menu detail fills last. No artificial per-card stagger.

```
POST /api/retrieve
  req:  { brief: string, prefs?: { ordering_model?: "shared"|"two-entree",
          drinks?: string[], dietary?: string[], price_max?: int, neighborhood?: string } }
  res:  { spread_id: string,
          evenings: [ 3 × {
            restaurant_id, name, cuisine, neighborhood, price_tier,
            role: "dependable"|"adventurous"|"wildcard",
            brief_line: string   // <=20w, deterministic from brief↔attributes — NOT LLM in MVP
          } ] }
  // server: Haiku parse → filter → vector + MMR. No post-retrieval LLM. Target P50 1–2s.

POST /api/compose/:restaurant_id     (called 3× in parallel, STREAMED)
  req:  { spread_id, restaurant_id }
  res (stream): { rationale: string (~50–60w), courses: Course[],
                  beverages: Beverage[], estimated_cents: int, menu_completeness }
  // one Sonnet call; stream tokens. Rationale ~5s typical; bound the validate-retry tail
  // (cap retries + timeout), degrade gracefully: ship rationale, lazy-load menu.

POST /api/swap-course        { evening_id, course_index } → replacement course
POST /api/regenerate-evening { spread_id, slot }          → different restaurant from pool
GET  /api/e/:share_token     → read-only evening
POST /api/flag               { restaurant_id }            → user-flag verification
```

`Course` / `Beverage` / restaurant shapes: see `project_plan.md` §2 and the worked examples in `menu/*.json`.

## Prompt stubs (starting points — iterate in Phase 1)

**Parse (Haiku):** "Extract structured fields from this date-night brief. Return strict JSON: `{cuisine[], price_max, vibe[], ordering_model?, drinks[], dietary[], party_size=2, occasion?, neighborhood?, activity_intent?}`. Use null for anything not stated; do not invent constraints. Brief: «{brief}»"

**Compose (Sonnet):** "You are composing one date-night evening at {restaurant_name}. venue_format={venue_format}; menu_completeness={tier}. Inputs: structured brief, the room's character ({vibe_tags}, {noise_level}, {description}), and the available menu/beverages (below). Compose a coherent evening per the tier rules: full → a balanced multi-course meal (no key-ingredient repeats, sensible weight progression); partial → compose only validated dishes, narrate gaps at category level; experience-only → recommend the experience and one signature/pairing with no specific unverifiable dish claims. Use ONLY real items, each identified by dish_id — never invent items. Respect dietary constraints {dietary}. Write a 50–60 word rationale that reads like someone who has sat in that room. Return strict JSON: {courses[], beverages[], rationale, estimated_cents, menu_completeness}. Menu: {menu_json}"

Validate every returned dish_id against the supplied menu; on any miss, reject and retry once, then fall back to a lower completeness tier.

## How to run

Setup: `npm install`; copy `.env.example` → `.env.local` and set `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `GOOGLE_PLACES_API_KEY` (never commit). For the import render path also: `npx playwright install chromium` + the host libs noted in the status section above.

| Script | What |
|---|---|
| `npm run dev` | Phase 2 web app → http://localhost:3000 (mobile 390px shell) |
| `npm run engine -- "brief"` | Phase 1 headless engine → 3-evening JSON (`--json` for JSON only) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` / `start` | Next.js production build / serve |
| `npm run liveness` | Stage 1 — probe the raw list → `data/worklist.json` |
| `npm run ingest -- "Name" \| --state blocked \| --url <pdf>` | Stage 2/3 — render/PDF → Claude → `menu/<slug>.json` |
| `npm run enrich -- [slugs]` | Stage 4 — Places geo/closure + LLM attrs → `data/import_attributes.json` |
| `npm run build:catalog` / `build:embeddings` | rebuild `data/restaurants.json` / `data/embeddings.json` |

`data/restaurants.json` + `data/embeddings.json` are generated but **checked in** (precompute, per project_plan §8). Re-run `build:catalog` + `build:embeddings` after any menu/enrichment change. `scripts/extract_seed.py` (one-time) lifts the Excel seed → `data/seed_attributes.json`.

## Data status (so you don't trust the seed blindly)

Of the 95 seed rows, ~25 are dead/closed/parked/hijacked and ~70 are live. Full menus are the minority; expect JS-rendered, PDF, image, tasting, and external-platform sources. Run the website-liveness check before trusting any row (see `project_plan.md` §5). For Phase 1, work from the restaurants that already have structured menus in `menu/*.json` plus whatever you ingest; you do NOT need all 90 to prove the engine — ~10–15 across venue formats is enough.
