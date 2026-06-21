// Stage 3 extraction — structure raw menu text (rendered HTML or PDF) into the
// menu/*.json schema via one Claude call. The single vision/text extraction service
// from Restaurant_Finder_Process.md §3; same schema as menu/EXTRACTION_SPEC.md.
import { config } from "../config.js";
import { anthropic, textOf, parseJsonLoose } from "../llm/anthropic.js";
import type { MenuFile, MenuDish, MenuBeverage } from "../types.js";

export interface ExtractMeta {
  name: string;
  neighborhood: string | null;
  cuisine: string | null;
  source_url: string;
  extraction_method: string; // "pdf" | "html (rendered)"
}

const SYSTEM = `You convert a restaurant's raw menu text into STRICT JSON. The text may be messy (PDF column bleed, rendered-page noise) — reconstruct dishes and prices sensibly but NEVER invent items or prices.

Return ONLY this JSON object:
{
  "venue_format": "full-menu|share-plate|tasting-only|counter|activity",
  "menu_completeness": "full|partial|experience-only",
  "menu_volatility": "static|seasonal|daily|unknown",
  "notes": "1-2 sentences: what was captured, any ambiguity (e.g. column bleed), bottle list skipped, etc.",
  "dishes": [ { "course_type":"appetizer|salad|entree|dessert|side|plate","name":string,"description":string,"price_cents":int|null,"price_note":string|null,"dietary_tags":["VEG"|"VEGAN"|"GF"],"key_ingredients":[],"weight_score":null,"richness_score":null } ],
  "beverages": [ { "type":"wine|beer|cocktail|sake|na","name":string,"style":string,"glass_cents":int|null,"bottle_cents":int|null,"region":string|null,"vintage":string|null,"flavor_tags":[] } ]
}
Rules: prices in integer cents ($28 -> 2800, $28.50 -> 2850); market/no price -> price_cents null with a price_note. dietary_tags only when the menu explicitly marks VEG/V, VEGAN/VG, GF. Map pizzas/pastas/large plates to entree; tapas/izakaya/small-plates venues -> venue_format share-plate with course_type "plate". A fixed tasting/omakase with no à la carte -> venue_format tasting-only/counter, menu_completeness experience-only, dishes []. If the text has no usable dish data, set menu_completeness experience-only and dishes []. Capture cocktails + by-the-glass wine; you may skip a long bottle list (note it).`;

function coerceDish(d: any): MenuDish | null {
  if (!d || typeof d.name !== "string" || !d.name.trim()) return null;
  const COURSE = ["appetizer", "salad", "entree", "dessert", "side", "plate"];
  const ct = COURSE.includes(d.course_type) ? d.course_type : "entree";
  const pc = Number(d.price_cents);
  const diet = Array.isArray(d.dietary_tags)
    ? d.dietary_tags.filter((t: any) => ["VEG", "VEGAN", "GF"].includes(t))
    : [];
  return {
    course_type: ct,
    name: d.name.trim(),
    description: typeof d.description === "string" ? d.description : "",
    price_cents: Number.isFinite(pc) && pc > 0 ? Math.round(pc) : null,
    price_note: typeof d.price_note === "string" ? d.price_note : null,
    dietary_tags: diet,
    key_ingredients: [],
    weight_score: null,
    richness_score: null,
  };
}

function coerceBev(b: any): MenuBeverage | null {
  if (!b || typeof b.name !== "string" || !b.name.trim()) return null;
  const TYPES = ["wine", "beer", "cocktail", "sake", "na"];
  const gc = Number(b.glass_cents);
  const bc = Number(b.bottle_cents);
  return {
    type: TYPES.includes(b.type) ? b.type : "cocktail",
    name: b.name.trim(),
    style: typeof b.style === "string" ? b.style : "",
    glass_cents: Number.isFinite(gc) && gc > 0 ? Math.round(gc) : null,
    bottle_cents: Number.isFinite(bc) && bc > 0 ? Math.round(bc) : null,
    region: typeof b.region === "string" ? b.region : null,
    vintage: typeof b.vintage === "string" ? b.vintage : null,
    flavor_tags: [],
  };
}

export async function extractMenu(rawText: string, meta: ExtractMeta): Promise<MenuFile> {
  const msg = await anthropic().messages.create({
    model: config.composeModel,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `RESTAURANT: ${meta.name} — ${meta.cuisine ?? ""}, ${meta.neighborhood ?? ""}, Seattle.\n\nRAW MENU TEXT:\n${rawText.slice(0, 24000)}`,
      },
    ],
  });
  const r = parseJsonLoose<any>(textOf(msg));
  const dishes = (Array.isArray(r?.dishes) ? r.dishes : []).map(coerceDish).filter(Boolean) as MenuDish[];
  const beverages = (Array.isArray(r?.beverages) ? r.beverages : []).map(coerceBev).filter(Boolean) as MenuBeverage[];
  const VENUE = ["full-menu", "share-plate", "tasting-only", "counter", "activity"];
  const COMPLETE = ["full", "partial", "experience-only"];
  return {
    restaurant: meta.name,
    neighborhood: meta.neighborhood ?? "",
    cuisine: meta.cuisine ?? "",
    venue_format: VENUE.includes(r?.venue_format) ? r.venue_format : "full-menu",
    menu_completeness: COMPLETE.includes(r?.menu_completeness)
      ? r.menu_completeness
      : dishes.length > 0
        ? "full"
        : "experience-only",
    source_url: meta.source_url,
    captured_at: "2026-06-20",
    menu_status: dishes.length > 0 ? "complete" : "none-accessible",
    menu_volatility: typeof r?.menu_volatility === "string" ? r.menu_volatility : "unknown",
    extraction_method: meta.extraction_method,
    notes: typeof r?.notes === "string" ? r.notes : "Auto-extracted via headless render / PDF pipeline.",
    dishes,
    beverages,
  };
}
