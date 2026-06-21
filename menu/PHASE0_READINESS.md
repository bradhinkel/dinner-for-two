# Phase 0 — Data Readiness Summary

_Last updated: 2026-06-20_

Phase 0 exit criterion (per `project_plan.md` §8): **enough composer-ready restaurants to span every `venue_format` branch**, with `venue_format` + `menu_completeness` backfilled on every row and the error-handling rules locked. **Status: met.**

## What's in `menu/*.json`

19 structured restaurant files, all schema-valid (course_type / venue_format / menu_completeness / dietary-tag vocab checked; prices in integer cents). **465 dishes, 119 beverages.** Schema + rules: `EXTRACTION_SPEC.md`. Canonical worked example: `the-pink-door.json`.

### Composer-ready (real dish data) — 15 restaurants

| Restaurant | Neighborhood | Cuisine | venue_format | completeness | dishes |
|---|---|---|---|---|---|
| The Pink Door | Pike Place | Italian-American | full-menu | full | 32 |
| Café Campagne | Pike Place | French | full-menu | full | 32 |
| Cutters Crabhouse | Pike Place | Seafood | full-menu | full | 43 |
| Le Coin | Fremont | French | full-menu | full | 20 |
| Terra Plata | Capitol Hill | Pacific NW | full-menu | full | 22 |
| The Ballard Cut | Ballard | Steakhouse | full-menu | full | 23 |
| Grappa | Queen Anne | Mediterranean | full-menu | full | 39 |
| Cornuto | Phinney Ridge | Italian pizzeria | full-menu | full | 34 |
| Madrona Arms | Madrona | Gastropub | full-menu | full | 45 |
| Pam's Caribbean Kitchen | Wallingford | Caribbean | full-menu | full | 26 |
| The Yard Café | Greenwood | Latin American | full-menu | full | 28 |
| The Harvest Vine | Madison Valley | Spanish (Basque) | share-plate | full | 24 |
| Black Bottle | Belltown | Gastropub small plates | share-plate | full | 33 |
| Revel | Fremont | Modern Korean | share-plate | full | 18 |
| Kisaku | Tangletown | Japanese sushi | counter | partial | 46 |

### Error-case / experience-led rows (no dish data — by design) — 4 restaurants

These are the canonical tier examples; each is the *intended* shape of its branch, not a gap.

| Restaurant | venue_format | completeness | Why no dishes |
|---|---|---|---|
| Altura | tasting-only | experience-only | No à la carte by design ($175pp tasting; dishes described tableside). Canonical tasting-only case. |
| Rob Roy | activity | experience-only | Beverage-led cocktail bar; menu is 7 image scans, little/no dinner food. Canonical activity case. |
| The Walrus and the Carpenter | share-plate | experience-only | Daily-rotating PDF menu, fetch timed out; any snapshot stale in 24h. Compose at category level. |
| Spinasse | full-menu | experience-only | Famous room with no usable online menu (static 2016 site). Needs human-entry / reservation-platform fallback. |

## venue_format branch coverage

- **full-menu** — 11 with data ✓
- **share-plate** — 3 with data ✓
- **counter** — 1 with data (Kisaku) ✓
- **tasting-only** — Altura, experience-only ✓ (correct shape: this branch *is* experience-led)
- **activity** — Rob Roy, experience-only ✓ (correct shape: beverage-led, no multi-course meal)

All three `menu_completeness` tiers are exercised: **full** (14), **partial** (1), **experience-only** (4) — so Phase 1 can test every composer route (full evening / category-level / experience-led) without more data.

## Error taxonomy & handling rules (locked)

The rules these examples validate live in:
- `triage-report.html` — all 95 seed rows bucketed (24 ready / 31 JS-render / 8 PDF / 7 image / 4 external-platform / 3 tasting / 1 no-menu / 2 unfetched / 15 dead).
- `project_plan.md` §4 (composer routing on venue_format **and** menu_completeness) and §5 (website-liveness gate + freshness pipeline).
- `EXTRACTION_SPEC.md` — the extraction contract used to build these files.

## Notes / known limitations (for Phase 1+)

- **Beverages are partial by design.** Captured cocktails + by-the-glass wine + notable beer/sake (what composition pairs against), not full 150-SKU bottle lists. Several rooms publish drinks on a separate page not captured (Harvest Vine, Le Coin, Ballard Cut, Café Campagne, Grappa) — `beverages: []` there; noted per file.
- **Snapshots, not a live feed.** All `captured_at: 2026-06-20`. Menus drift (esp. Walrus = daily, Harvest Vine = daily). Freshness is the Phase 5/6 pipeline's job.
- **Dietary tags only where the menu marks them.** No inference. Many full-menu rooms publish none → empty `dietary_tags`.
- **Kisaku** is `partial`: à la carte nigiri/rolls captured from the public page; dinner omakase pricing + sake list not captured.
- **weight_score / richness_score / key_ingredients** intentionally left null/empty — derived later (composer-side or an enrichment pass), not part of Phase 0.
- This is **not** the 100-solid Phase 3 gate — it's the ~12–15 format-spanning set Phase 1 needs to prove the engine. Reaching 100 is a discovery effort (deferred).
