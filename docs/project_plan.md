# Dinner for Two — Build Plan (project_plan.md)

Developer-facing companion to **Project Plan v2**. The v2 `.docx` holds product rationale; this file is the implementation spec. Keep them in sync.

## 0. Current state

- **Data:** `Seattle_Restaurants_Enriched.xlsx` — ~90 verified-open restaurants (`Enrichment Status = Enriched`), each with description, neighborhood, cuisine, price tier, vibe/ambiance tags, date-night score, reservations, dietary flags, 2 hero dishes, and a verified date. Closed rows are flagged red; review rows amber. This is the seed import, not the runtime store.
- **Not yet built:** full structured per-restaurant menus + beverage lists, lat/long, the app itself.
- **Immediate goal:** stand up an MVP website to test the idea end to end.

## 1. Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router) + TypeScript + Tailwind; PWA manifest; deploy on Vercel |
| API | Next.js route handlers (`/api/*`) for MVP |
| LLM | Anthropic — Haiku (brief parse), Sonnet (composition) |
| Data + vector | Postgres + `pgvector` (Supabase or Neon) — one store for filters + embeddings |
| Jobs | Small worker (cron) for ingestion + monthly freshness sweep |
| Embeddings | Any current text-embedding model; store in `restaurants.embedding` |

Design rule: **LLM cost is bounded** — only the 3 final candidates are composed, never the whole catalog. Architecture is unchanged from 90 to 5,000+ rows.

## 2. Data model (Postgres + pgvector)

```sql
create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  neighborhood text,
  latitude double precision,
  longitude double precision,
  cuisine_tags text[],
  price_tier int,                  -- 1..4
  vibe_tags text[],                -- romantic, intimate, waterfront, view, activity, ...
  venue_format text,               -- full-menu | share-plate | tasting-only | counter | activity
  date_night_score int,            -- 1..5
  description text,
  embedding vector(1536),          -- description + tags
  reservation_url text,
  status text default 'open',      -- open | closed | seasonal | unverified
  source_signals jsonb,            -- {places, resy, yelp}
  last_checked_at timestamptz,
  verified_at timestamptz
);
create index on restaurants using ivfflat (embedding vector_cosine_ops);
-- geo: store lat/long now; add PostGIS / earthdistance when regional radius queries land.

create table dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  course_type text,                -- appetizer | salad | entree | dessert | side | plate
  name text, description text, price_cents int,
  dietary_tags text[], key_ingredients text[],
  weight_score int, richness_score int   -- 1..5
);

create table beverages (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  type text,                       -- wine | beer | cocktail | sake | na
  name text, style text,
  glass_cents int, bottle_cents int,
  flavor_tags text[]
);

create table evenings (
  id uuid primary key default gen_random_uuid(),
  brief text, restaurant_id uuid references restaurants(id),
  ordering_model text,             -- shared | two-entree
  spread_role text,                -- dependable | adventurous | wildcard
  courses jsonb, beverages jsonb,
  rationale text, estimated_cents int,
  share_token text, created_at timestamptz default now()
);

create table verifications (        -- freshness audit trail
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid references restaurants(id),
  checked_at timestamptz default now(),
  signals jsonb, verifier text,     -- 'pipeline' | 'human' | 'user-flag'
  outcome text, notes text
);
```

## 3. Retrieval — two-stage, relevance + diversity

The core IP. **Not top-k.** Goal: 3 strong but deliberately different evenings.

1. **Parse** (Haiku): brief → `{cuisine[], price_max, vibe[], ordering_model?, drinks[], dietary[], party_size=2, occasion?, activity_intent?}`.
2. **Stage 1 — broad fuzzy retrieval:** hard-filter on SQL (`status='open'`, price ≤ ceiling, dietary, neighborhood/radius, venue_format if constrained), then `pgvector` cosine over `embedding` → candidate pool of ~20–40 above a relevance threshold (not nearest-3).
3. **Stage 2 — MMR diversity select:** pick final 3 maximizing `λ·relevance − (1−λ)·max_sim_to_chosen`. Tune `λ` on held-out briefs. Assign spread roles: closest = **dependable**, a mid-relevance off-axis pick = **adventurous**, a deliberately different vibe/cuisine/price = **wildcard**.
4. Pass the 3 to the composer.

Tunables: candidate-pool size, relevance threshold, MMR `λ`, similarity metric (consider blending embedding distance with explicit tag/price distance so "different" means different on attributes humans notice, not just embedding space).

## 4. Composer — route on `venue_format`

One Sonnet call per restaurant, in parallel. Branch on `venue_format`. **Principle: open enough to add value, bounded enough to never look unappealing.**

**Composer inputs:** structured brief + full menu (with `course_type` coverage) + beverage list + the room's character signals (`vibe_tags`, `noise_level`, `description`, optional `experience_notes`). Character must reach the model, not just the menu.

| venue_format | Composer behavior |
|---|---|
| `full-menu` | 4-course (or two-entree) evening; weight/progression rules; no key-ingredient repeats |
| `share-plate` | Coherent 4–6 shareable plates, framed "a meal to share," same balance rules |
| `tasting-only` | Present the set menu as-is + pairing; **no course fabrication**; LLM adds curation + rationale |
| `counter` | Omakase + sake/beverage pairing; no fabrication |
| `activity` | Experience-first: recommend venue + one simple food+drink pairing; no multi-course meal |

**Composition is goal + guardrails, not slot-filling.** Give the model latitude to reason over an incomplete menu and a specific atmosphere — that fuzzy judgment is what it's good at and rule systems aren't. Two principles on top of the format routing:

- **Menu-driven, not template-driven:** the course arc is a *target*. Compose from the actual `course_type` inventory; substitute or compress when a course type is absent; use the single dessert if that's all there is; never force or fabricate a slot. Minimum-viable-evening floor = a main + one supporting course (or pairing); below that, drop to recommendation mode.
- **Character-aware:** let `vibe_tags` / `noise_level` / `description` shape selection and especially the rationale — cabaret → shareable + "order before the curtain"; slow tasting → pacing language; loud → robust, casual plates. Rationale should read like someone who's sat in that room.

Guardrails (all): real items only, **validated by dish ID** (reject + retry on hallucination); respect dietary constraints; **dinner stays the spine** (latitude is in *how* the dinner composes, not whether it wanders off-dinner); **appeal floor** — fall back to recommendation mode rather than forcing a template. Output strict JSON: `{courses[], beverages[], rationale, estimated_cents}`.

**Menu-completeness is a first-class input, not an assumption (added after the §0 triage).** The seed-list triage showed that fully structured menus are the *minority* — most viable venues arrive as JS-rendered pages, PDFs, image scans, tasting menus, or external-platform listings, and several well-known rooms have no usable online menu at all. Diners expect specific, famous restaurants (Walrus, Spinasse, Altura), so dropping the menu-poor ones isn't an option — handling them well *is* the product. The composer therefore routes on a `menu_completeness` tier as much as on `venue_format`:

- **`full`** — structured, dish-ID-validated menu → compose the full evening as above.
- **`partial`** — some dishes known (e.g. a captured-but-stale or representative menu) → compose at the dish level where IDs validate, narrate the rest at the category level ("a spread of their oysters and a crudo or two"), flag freshness.
- **`experience-only`** — no reliable dish data (tasting-only, no-menu, image not yet OCR'd) → **experience-led mode**: sell the room, the occasion fit, and a known signature or pairing; make zero specific dish claims that can't be validated. This is a primary path, designed and prompted as such — not a degraded error state.

The rationale must read equally well in all three tiers; a great experience-only recommendation should feel intentional, not like missing data.

## 5. Validation pipeline (freshness)

Scheduled worker, monthly full sweep (+ ad-hoc for new/high-churn rows).

- **Website liveness is the first, cheapest viability gate (added after triage).** Before any menu work or paid API call, probe the restaurant's own URL. A site that is dead, parked/for-sale, hijacked (spam redirect), erroring, or password-locked ("Private Site") is a *strong* closed/non-viable signal — in the seed triage, every parked/hijacked domain was a dead restaurant, and several "JS-rendered" rows turned out to be erroring or locked, not recoverable. Liveness states to capture: `live` · `error` · `parked` · `hijacked` · `private` · `redirected-offsite`. Anything but `live`/`redirected-to-known-new-domain` routes straight to review/closed and skips ingestion.
- **Signals:** website liveness (primary, cheap — run first) · Google Places `business_status` (primary) · reservation-platform listing present? (strong) · Yelp closed banner (weak; never auto-closes alone).
- **Logic:** 2 agreeing signals → auto-`status='closed'`, drop from live set, write `verifications`. 1 signal or conflict → human review queue. Write `status`, `last_checked_at`, `source_signals` every run. A failed-website signal alone routes to review (cheap to confirm).
- **App:** suppress non-`open` / stale rows from retrieval; surface `verified_at`. User "flag outdated" button → `verifications` with `verifier='user-flag'`.

## 6. Discovery ops (find new restaurants)

Monthly human-in-the-loop ritual, not automated. Assistant sweeps sources (Eater Seattle, Seattle Met, The Infatuation, Seattle Times food, neighborhood blogs, Yelp/Google "new") → staging candidates with proposed cuisine/neighborhood/price/venue_format → triage against coverage matrix (favor thin gaps) → enrich + verify → human approve into live set.

## 7. API surface (MVP)

**Two-call model** — the spread is delivered in two stages so the diner gets something to look at fast, with the slow generative work streamed behind it.

- `POST /api/retrieve` → `{brief, prefs}` ⇒ `{ spread_id, evenings: [3 × {restaurant, role, header (name/cuisine/neighborhood/price), brief_line}] }`. Server-side: Haiku parse → SQL filter → vector + MMR select. No post-retrieval inference. Target P50 1–2s. `brief_line` is the static description or a deterministic line templated from the brief↔restaurant attribute overlap — **not** personalized via LLM in the MVP (revisit if testing shows it matters).
- `POST /api/compose/:restaurant_id` (×3, parallel, **streamed**) → `{ rationale (≈50–60w), courses[], beverages[], estimated_cents }`. One Sonnet call per restaurant; stream tokens so rationale fills live. Rationale ≈5s typical; validate-and-retry tail can exceed 10s (bound it, degrade gracefully — ship rationale, lazy-load menu).
- `POST /api/swap-course` → `{evening_id, course_index}` ⇒ replacement course
- `POST /api/regenerate-evening` → `{spread_id, slot}` ⇒ different restaurant from pool
- `GET /api/e/:share_token` → read-only evening
- `POST /api/flag` → `{restaurant_id}` ⇒ writes a user-flag verification

**Reveal choreography:** all three header cards + brief lines appear together the instant `/api/retrieve` lands (the data is available at once — no artificial per-card stagger). Rationale then streams into all three in parallel; menu detail fills last. Anticipation comes from exposing real generation, not manufactured pauses.

## 8. Build phases

Laptop-first. Everything through Phase 3 runs locally with the data layer **in memory** (load the enriched seed on boot; embeddings precomputed and checked into the repo as JSON; cosine + MMR in JS). The production database is deferred to Phase 4 — the moment it's actually needed — so we validate the product before building infra. Retrieval is a clean module so the in-memory → pgvector swap is contained.

**Phase 0 — Data readiness.** Get the seed set composer-ready. Pull structured menus, backfill `venue_format` + `menu_completeness` onto every row, and lock the handling rules for the error cases menu-pulling surfaces. Deliverable is as much the error taxonomy + rules as the data. *Exit:* enough composer-ready restaurants to span every `venue_format` branch.

*Triage findings (2026-06-20, see `/menu/triage-report.html`, 95 seed rows):* 24 clean-html (ready), 31 JS-rendered (recoverable), 8 PDF, 7 image, 4 external-platform, 3 tasting-only, 1 no-menu, 2 unfetched, **15 closed/parked/hijacked (drop)**. Two consequences: (1) the seed list yields only ~80 live venues, so hitting the 100-solid gate needs new sourcing, not just extraction; (2) **a JS-rendering fetch (headless Chrome/Playwright) is the highest-leverage ingestion investment** — it likely converts most of the 31 JS-rendered rows to clean-html, roughly doubling ready coverage before any PDF/OCR work. PDF + image (15 venues) sit behind a single model-assisted extraction pass. The 15 dead rows are also the first real input to the §5 freshness pipeline (~16% of the list already stale).

*Extraction-accessibility test (sample, 2026-06-20):* (1) **JS render is not a silver bullet.** Of 8 rendered: 2 yielded a full clean menu (React/JS-shell sites — Windy City Pie, Xi'an Noodles), 3 rendered the room's *character* (hours/vibe/occasion) reliably but the dish list sat behind an accordion, a separate page, or an embed (Ethan Stowell, Squarespace, WordPress), and 3 were actually non-viable (Saltoro/Peso's erroring, Stateside password-locked) — i.e. mis-bucketed, caught by the liveness gate above. (2) **Text-based PDFs extract cleanly** — `web_fetch` returned Momiji's entire menu with prices; large/scanned PDFs (Walrus timed out) fall back to OCR. (3) **Clean image-export menus are highly legible to a vision model** (Taurus Ox `Mains.png` — full text, prices, dietary marks). **Inversion worth noting:** PDFs and clean image menus are *more* reliable than the JS-render bucket, because a PDF/image always contains the whole menu while a JS site may be down, locked, or partial. Design implication: one **vision-capable extraction service** that accepts rendered-HTML text, PDF text, or an image and emits the structured `dishes`/`beverages` JSON covers clean-HTML + PDF + image uniformly; the genuinely hard bucket is JS-render-partial, where the dish list needs interaction or a corrected sub-URL.

*Liveness sweep of the 31 JS-render rows + 2 unknowns (2026-06-20):* 9 of the 31 "recoverable" rows were actually **dead/non-viable** — parked landers (Witness), 404s (Bastille), SSL/privacy errors (Sawyer, Local 360, Barrio, Peso's, Saltoro), gambling-spam hijacks (Purple Café), or password-locked (Stateside) — plus 1 of 2 unknowns (Citizen, hijacked). That moves total dead/non-viable to **~25 of 95 (~26%)**, leaving **~70 live venues** (well short of 100 → discovery needed, deferred for now). The rest split into 13 confirmed-live and 9 live-but-JS-only (empty server HTML; need full render). Net lesson: run the cheap liveness probe *first* — it reclassifies a quarter of "JS-rendered, has data" rows as dead before any render/extraction spend. The discovery → verification → ingestion workflow this implies is specced separately in **`Restaurant_Finder_Process.md`** (built Phase 4/5, operated Phase 6).

**Phase 1 — Headless engine.** The brain alone, no UI. Parse and compose prompt templates; two-stage retrieval + MMR; composer with `venue_format` routing and dish-ID validation. Run from a script against in-memory data. Tune retrieval/MMR `λ` and iterate prompts here, free of UI noise. *Exit:* "brief in → 3 distinct, genuinely good evenings out" from the CLI.

**Phase 2 — Experience.** Build the screens on the proven engine: mobile-first brief input → composing → hero → "different room" → menu → course/plate swap + restaurant regenerate → share URL; PWA manifest. Two-call timing model (see §7). Still in-memory. *Exit:* full end-to-end loop demoable in the laptop browser.

**Phase 3 — Hardening + content growth.** Dish-ID validate-and-retry with a bounded budget/timeout and graceful degradation; loading/error/empty states; user "flag outdated" path; **restaurant/menu update step** — a repeatable workflow to refresh a stale menu or correct a row. Grow the catalog in parallel toward the Phase 4 gate. *Exit gate:* **100 solid (composer-ready, verified) restaurants** in the list.

**Phase 4 — Production data layer (still local).** Stand up Postgres + pgvector, scalable toward the 5,000 target; migrate the 100; swap the in-memory retrieval module for the DB-backed one. App stays on the laptop. *Exit:* a completely functional app running locally against the real database — no deployment yet.

**Phase 5 — Deploy.** Source control to git; deploy to the droplet; secrets/env, build pipeline, smoke tests in the deployed environment. *Exit:* the Phase 4 app, proven, running on the droplet.

**Phase 6 — Operations / running framework.** Restaurant verification (still-open sweep per §5); the menu-freshness strategy (re-check cadence vs. accept-staleness-plus-user-flag — the hard ongoing problem, since menus change silently); new-restaurant intake code + the operational runbook for adding and updating restaurants (§6).

## 9. Open questions

- MMR similarity: pure embedding vs. blended attribute distance — decide via held-out brief eval.
- `venue_format` assignment: derive during menu ingestion; backfill the existing 90 from venue type / tags.
- Tasting/activity venues in the spread: should a spread ever be *all* non-composable formats? Likely cap (e.g., ≤1 activity per spread) so output stays meal-centric.
- Embedding input: description only vs. description + structured tags (test both).
