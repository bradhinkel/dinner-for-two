# Menu Extraction Spec (Phase 0)

Goal: turn one restaurant's online menu into a structured JSON file the composer can use.
The canonical worked example is `menu/the-pink-door.json` — match its shape exactly.

## Output file

Write to `menu/<slug>.json` where `<slug>` is the kebab-case restaurant name
(e.g. "The Harvest Vine" -> `the-harvest-vine.json`).

## Top-level shape

```json
{
  "restaurant": "string",
  "neighborhood": "string",
  "cuisine": "string",
  "venue_format": "full-menu | share-plate | tasting-only | counter | activity",
  "menu_completeness": "full | partial | experience-only",
  "source_url": "the exact menu URL fetched",
  "captured_at": "2026-06-20",
  "menu_status": "complete | partial | none-accessible | image-only | none-by-design",
  "menu_volatility": "seasonal | daily | weekly | unknown",
  "extraction_method": "html | pdf | image | html (description only) | none",
  "notes": "1-4 sentences: what you captured, what you couldn't, freshness/quirks, any MP items, whether bottle list was skipped, etc.",
  "dishes": [ ...Dish ],
  "beverages": [ ...Beverage ]
}
```

## Dish

```json
{
  "course_type": "appetizer | salad | entree | dessert | side | plate",
  "name": "string",
  "description": "string (menu description verbatim-ish; '' if none)",
  "price_cents": 2800,            // integer US cents; null if no fixed price (e.g. market price)
  "price_note": null,             // e.g. "MP (market price)", "24 / 18 (two sizes)"; else null
  "dietary_tags": ["VEG","VEGAN","GF"],  // only those explicitly marked on the menu; [] otherwise
  "key_ingredients": [],          // leave [] — derived later
  "weight_score": null,           // leave null — derived later
  "richness_score": null          // leave null — derived later
}
```

`course_type` guidance:
- `appetizer` = starters / antipasti / small starters that begin a meal.
- `salad` = salads / light vegetable-forward starters.
- `entree` = mains, pastas, pizzas, large plates meant as a main.
- `dessert` = sweets.
- `side` = side dishes / contorni / add-ons.
- `plate` = use ONLY for share-plate venues where items are shareable small plates
  not mapping cleanly to a course (tapas, izakaya, oyster-bar spreads). For full-menu
  restaurants, prefer appetizer/salad/entree/dessert/side.

## Beverage

```json
{
  "type": "wine | beer | cocktail | sake | na",
  "name": "string",
  "style": "string (e.g. 'red', 'white', 'sparkling', or the spirit/ingredient line for cocktails)",
  "glass_cents": 1700,            // integer cents; null if not sold by glass
  "bottle_cents": null,           // integer cents; null if not listed
  "region": null,                 // wine region if shown, else null
  "vintage": null,                // year/'NV' if shown, else null
  "flavor_tags": []               // leave []
}
```

Beverage scope: capture cocktails + by-the-glass wine + notable beer/sake. You do NOT
need to capture a full 150-SKU bottle list — by-the-glass + cocktails is what composition
pairs against. Say so in `notes` if you skip the bottle list.

## Rules

- **Prices in integer cents.** $28 -> 2800. $28.50 -> 2850. No fixed price (market price) -> `price_cents: null`, `price_note: "MP (market price)"`.
- **Real items only**, verbatim names/descriptions. Never invent dishes, prices, or dietary tags.
- **Dietary tags** only when the menu explicitly marks them (VEG/V, VEGAN/VG, GF). Don't infer.
- If a dish lists two sizes/prices, put the smaller in `price_cents` and the full note in `price_note`.
- The menu may live on the homepage, a `/menu` page, or sub-pages (food vs drinks) — fetch what you need to get the full dinner menu + beverages. If dinner and brunch/lunch both exist, capture **dinner** (note it).
- Output **strict valid JSON** (double quotes, no trailing commas, no comments in the actual file).

## menu_completeness tier (composer routes on this)

- `full` — you extracted a structured, current dinner menu with most/all dishes + prices.
- `partial` — you got some dishes but the menu is incomplete, stale/daily-rotating, or blocked in part.
- `experience-only` — no reliable dish data (tasting-only by design, image-not-extracted, no menu). Leave `dishes`/`beverages` `[]` and explain in `notes`.

## venue_format

- `full-menu` — standard apps/salads/entrees/desserts.
- `share-plate` — tapas / izakaya / small-plates / oyster bar / dim sum (a meal to share).
- `tasting-only` — single fixed tasting/prix-fixe, no a la carte.
- `counter` — omakase / sushi counter.
- `activity` — bar/activity venue, beverage-led, minimal food.

## If the site is dead / blocked / non-viable

If the URL is parked, hijacked, erroring, password-locked, or has no usable menu, do NOT
fabricate. Write the JSON with `menu_completeness: "experience-only"` (or `partial`),
empty `dishes`/`beverages`, and a `notes` field explaining exactly what you hit (this is a
valid Phase 0 outcome and feeds the liveness/freshness taxonomy).

## Return value

Return a one-line summary: `<slug>: <venue_format>/<menu_completeness>, N dishes, M beverages — <one phrase on any issue>`.
