# Restaurant Finder — Operational & Process Doc

Companion to `project_plan.md`. This describes how restaurants get **discovered, verified, and ingested** into the live set. Discovery is human-in-the-loop; verification, extraction, and ingestion are system-assisted with a human approval gate.

**Status:** process design + work tracking now. **Build:** the system stages (1–4, 6) are built in **Phase 4** (local) and deployed in **Phase 5**; discovery (Stage 0) and review (Stage 5) are ongoing human rituals that operationalize in **Phase 6**. This doc exists so the verification/ingestion work is tracked before it's built.

---

## 1. Why this exists

The diner expects specific, well-known restaurants — including ones with bad or missing menu data (Walrus, Spinasse, Altura). So the finder can't just harvest the easy ones; it has to carry the hard cases through a defined path or deliberately defer them. The empirical basis for this process is the June 2026 seed-list triage + liveness sweep (95 restaurants):

- **~26% of a hand-built seed list was already dead** — closed, domain parked/for-sale, hijacked to spam, SSL-erroring, or password-locked. Website liveness alone caught most of these.
- Fully structured menus are the **minority**. Viable venues arrive as JS-rendered pages, PDFs, image scans, tasting menus, or external-platform listings.
- **Format is not the difficulty axis.** Clean PDFs and image-export menus extract *better* than many "live" JS sites, because a PDF/image always holds the whole menu while a JS site may be partial, locked, or down.

The process below front-loads the cheap viability check, then routes each survivor to the right extraction path.

---

## 2. Roles

| Role | Owns |
|---|---|
| **Curator (human)** | Stage 0 discovery; Stage 5 review/approval; adjudicating system flags |
| **System (pipeline)** | Stage 1 liveness; Stage 2 format detection; Stage 3 extraction; Stage 4 enrichment; Stage 6 DB upsert; Stage 7 re-verification |

The human decides *what* enters and *whether* the result is good. The system does the fetching, structuring, and bookkeeping in between.

---

## 3. The pipeline

### Stage 0 — Discovery (human)
Curator sweeps sources — Eater Seattle, The Infatuation, Seattle Met, Seattle Times food, neighborhood blogs, "new on Resy/Tock," Google/Yelp "new & notable" — favoring coverage gaps (thin neighborhoods, cuisines, price tiers, `venue_format`s). Output: a **candidate list** (see §6 handoff format) with name, neighborhood, URL, cuisine guess, and a one-line "why it fits date-night."

### Stage 1 — Liveness & viability gate (system, cheap — run first)
Probe the candidate's own URL **before any paid API call or extraction**. Classify into a liveness state and act:

| Liveness state | Signal | Action |
|---|---|---|
| `live` | Real restaurant content / title | → Stage 2 |
| `redirected-to-known-domain` | 301 to a new official domain | Update URL → Stage 2 |
| `error` | 404, SSL/privacy error, DNS fail | → reject (probable closure), log |
| `parked` | "Domain for sale," registrar lander | → reject |
| `hijacked` | Redirects to spam/gambling/off-topic | → reject |
| `private` | Login gate ("Private Site") | → hold for manual check |

This gate is the single highest-yield filter: in the seed sweep it removed ~1 in 4 candidates at near-zero cost.

### Stage 2 — Menu acquisition & format detection (system)
For survivors, detect how the menu is published and capture the source + a `captured_at` timestamp + a `menu_volatility` flag (`static` / `seasonal` / `daily`):

| Format | Detection | Route |
|---|---|---|
| `clean-html` | Menu text present in fetched HTML | → Stage 3 (text) |
| `js-render` | Empty/SPA body; content client-side | Headless render (Chrome/Playwright); may need a click/sub-page → Stage 3 (text) |
| `pdf` | Menu link is a PDF | Download → Stage 3 (PDF text; OCR if scanned) |
| `image` | Menu is PNG/JPG scans | → Stage 3 (vision) |
| `external` | Menu on Toast/DoorDash/SevenRooms/Tock | Pull from platform → Stage 3 |
| `tasting` | Fixed tasting menu, no à la carte | Capture price + sample; mark `menu_completeness=experience-only` |
| `none` | No usable online menu | → manual entry queue |

### Stage 3 — Extraction (system, one vision-capable service)
A **single extraction service** accepts rendered-HTML text, PDF text, **or** an image and emits structured `dishes[]` / `beverages[]` JSON against the `project_plan.md` §2 schema. Validate every item by dish ID; flag low-confidence rows. This one service covers clean-html + js-render + pdf + image uniformly — do not build per-format extractors.

### Stage 4 — Enrichment (system)
Derive and attach: `venue_format`, `menu_completeness` tier (`full` / `partial` / `experience-only`), `vibe_tags`, `price_tier`, `date_night_score`, dietary flags, hero dishes, lat/long (geocode), and the description embedding.

### Stage 5 — Review & approval (human)
Curator reviews structured output **side-by-side with the source** (the `menu-review.html` QA pattern): confirm dishes/prices match, fix mis-parses, accept the `menu_completeness` tier, approve dietary flags. Approve, correct, or send back. Nothing reaches the live set unreviewed.

### Stage 6 — Database upsert (system)
Insert/update the restaurant + dishes + beverages; set `status='open'`, `verified_at=now()`, `source_signals`; write a `verifications` row (`verifier='human'`). Idempotent upsert so re-ingesting an existing restaurant updates rather than duplicates.

### Stage 7 — Re-verification cadence (system, ties to plan §5)
Scheduled rechecks: liveness probe (cheap, frequent) + menu-freshness recheck. `daily`-volatility venues (e.g., Walrus) recheck most often; `static` menus least. A failed liveness probe on a previously-live row → review queue (likely a new closure).

---

## 4. The worklist record (per candidate)

Tracked from Stage 0 through Stage 6:

```
candidate_id, name, neighborhood, url, cuisine_guess, why_fits,
liveness_state, menu_format, menu_volatility, captured_at,
extraction_status (pending|done|low-confidence|manual),
menu_completeness (full|partial|experience-only),
review_status (pending|approved|corrected|rejected),
ingest_status (pending|upserted), notes
```

---

## 5. Work estimate by bucket

Effort to take one *live* candidate from discovery to ingested, by menu format. "Auto" = system-only; "Assisted" = system + light human verify; "Manual" = human-entered.

| Bucket | Per-restaurant effort | Notes |
|---|---|---|
| `clean-html` | **Auto** (~min) | Extract + quick review |
| `js-render` (full) | **Auto–Assisted** | Render converts cleanly (e.g. React shells) |
| `js-render` (partial) | **Assisted** | Dish list behind accordion / sub-page / embed — needs interaction or corrected URL |
| `pdf` (text) | **Auto** | Text PDFs extract cleanly |
| `pdf` (scanned) / `image` | **Assisted** | Vision/OCR pass + verify; clean exports are highly legible |
| `external` | **Assisted** | Pull from platform; format varies |
| `tasting` | **Auto (light)** | No dish extraction — capture price + experience; experience-led composition |
| `none` | **Manual** | Source from reservation platform/press or hand-enter |
| `dead` (any liveness ≠ live) | **Reject (~0)** | Liveness gate; no extraction spend |

**Implication for planning:** the bulk of viable venues are Auto or light-Assisted. The real labor concentrates in `js-render-partial`, `image`/`scanned-pdf`, and `none` + the human review gate (Stage 5), which every candidate passes through. Budget Phase 4/5 build effort accordingly: the extraction service (Stage 3) and the review tooling (Stage 5) are the load-bearing pieces.

---

## 6. Discovery handoff format (human → system)

The curator passes a simple list the system can ingest at Stage 1. Minimum columns:

```
name, neighborhood, url, cuisine_guess, why_fits
```

The system enriches every downstream field. Keep the human's job to *finding and vouching*; everything mechanical is the system's.

---

## 7. Seed-list status (June 2026 baseline)

From the triage + liveness sweep of 95 seed rows: **~70 live / viable**, **~25 dead or non-viable**. Of the viable set, ~24 are clean-HTML-ready, ~22 are live JS sites (most one render or sub-URL away), ~15 are PDF/image (one extraction pass), plus a handful of external-platform and tasting venues. The seed list alone does **not** reach 100 solid restaurants — closing that gap is a Stage 0 discovery effort, deferred until after MVP learning per current direction.
