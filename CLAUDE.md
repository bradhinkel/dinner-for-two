# Dinner for Two — Build Guide (CLAUDE.md)

Read this first. It orients you, pins the decisions that aren't obvious from the code, and gives you the contracts and prompts to start Phase 1. When this file and another doc disagree, **this file and `project_plan.md` win**.

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

## How to run (fill in as you build)

- `npm install`; set `ANTHROPIC_API_KEY` in `.env.local` (never commit).
- Phase 1: `npm run engine -- "your brief here"` → prints the 3-evening JSON.
- Phase 2+: `npm run dev` → http://localhost:3000.

## Data status (so you don't trust the seed blindly)

Of the 95 seed rows, ~25 are dead/closed/parked/hijacked and ~70 are live. Full menus are the minority; expect JS-rendered, PDF, image, tasting, and external-platform sources. Run the website-liveness check before trusting any row (see `project_plan.md` §5). For Phase 1, work from the restaurants that already have structured menus in `menu/*.json` plus whatever you ingest; you do NOT need all 90 to prove the engine — ~10–15 across venue formats is enough.
