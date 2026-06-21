// compose() — one Sonnet call per restaurant, routed on venue_format AND
// menu_completeness, with dish-ID validation (reject + retry once, then tier fallback).
import { config } from "../config.js";
import { anthropic, textOf, parseJsonLoose } from "../llm/anthropic.js";
import { dishById, beverageById } from "../catalog/loadCatalog.js";
import type {
  ComposedBeverage,
  ComposedCourse,
  ComposedEvening,
  MenuCompleteness,
  ParsedBrief,
  Restaurant,
  SpreadPick,
} from "../types.js";

export type ComposeMode = ComposedEvening["compose_mode"];

export function modeFor(mc: MenuCompleteness): ComposeMode {
  return mc === "full" ? "full" : mc === "partial" ? "partial" : "experience-led";
}

// What the model is allowed to see of the menu (ids included for validation).
function menuPayload(r: Restaurant) {
  return {
    dishes: r.dishes.map((d) => ({
      dish_id: d.dish_id,
      course_type: d.course_type,
      name: d.name,
      description: d.description,
      price_cents: d.price_cents,
      dietary_tags: d.dietary_tags,
    })),
    beverages: r.beverages.map((b) => ({
      beverage_id: b.beverage_id,
      type: b.type,
      name: b.name,
      style: b.style,
      glass_cents: b.glass_cents,
    })),
  };
}

export function systemPrompt(): string {
  return `You compose ONE date-night evening for two at a specific restaurant. Return STRICT JSON only.

Route on BOTH venue_format and menu_completeness (tier):
- tier "full": compose a balanced multi-course evening from the menu — no key-ingredient repeats, sensible weight progression. shared ordering = one of each course to share; two-entree = shared starter + two distinct entrees + shared dessert. share-plate venue = an ordered sequence of 4-6 shareable plates framed as "a meal to share".
- tier "partial": compose only from the dishes given (validate by id); narrate any gap at the category level in the rationale; do not invent dishes.
- tier "experience-led": there is little/no reliable dish data. Make ZERO specific dish claims with ids. courses must be []. Sell the room, the occasion fit, and (at most) a known signature or pairing in prose. This is a designed primary path, not an error.

HARD RULES (all tiers):
- Use ONLY items from the provided menu, each referenced by its exact dish_id / beverage_id. NEVER invent an item or an id. If you cannot find a fitting real item, omit it.
- Respect dietary constraints.
- Dinner is the spine. A minimum-viable evening is a main plus one supporting course or a pairing; below that, drop to experience-led prose.
- Rationale: 50-60 words, written like someone who has actually sat in that room (use its vibe/noise/character).

Output JSON exactly:
{
  "compose_mode": "full"|"partial"|"experience-led",
  "courses": [ { "slot": string, "dish_id": string, "note": string } ],   // [] for experience-led
  "beverages": [ { "beverage_id": string|null, "name": string, "type": "wine"|"beer"|"cocktail"|"sake"|"na"|"descriptive", "pairing_note": string } ],
  "rationale": string,
  "estimated_cents": int
}
Set beverage_id to null ONLY when making a descriptive recommendation because the list is sparse (then type "descriptive").`;
}

export function userPrompt(r: Restaurant, p: ParsedBrief, mode: ComposeMode, correction?: string): string {
  const character = {
    name: r.name,
    cuisine: r.cuisine,
    neighborhood: r.neighborhood,
    venue_format: r.venue_format,
    menu_completeness: r.menu_completeness,
    tier_to_use: mode,
    vibe_tags: r.vibe_tags,
    noise_level: r.noise_level,
    description: r.description,
  };
  const brief = {
    cuisine: p.cuisine,
    vibe: p.vibe,
    ordering_model: p.ordering_model ?? "shared",
    drinks: p.drinks,
    dietary: p.dietary,
    party_size: p.party_size,
    occasion: p.occasion,
  };
  const menu = menuPayload(r);
  const lines = [
    `RESTAURANT CHARACTER:\n${JSON.stringify(character, null, 2)}`,
    `BRIEF:\n${JSON.stringify(brief, null, 2)}`,
    `MENU (use these ids only):\n${JSON.stringify(menu)}`,
  ];
  if (correction) lines.push(`CORRECTION: ${correction}`);
  return lines.join("\n\n");
}

export interface RawComposition {
  compose_mode?: string;
  courses?: { slot?: string; dish_id?: string; note?: string }[];
  beverages?: { beverage_id?: string | null; name?: string; type?: string; pairing_note?: string }[];
  rationale?: string;
  estimated_cents?: number;
}

export interface Validated {
  courses: ComposedCourse[];
  beverages: ComposedBeverage[];
  invalidDishIds: string[];
}

export function validate(r: Restaurant, raw: RawComposition): Validated {
  const courses: ComposedCourse[] = [];
  const invalidDishIds: string[] = [];
  for (const c of raw.courses ?? []) {
    const id = c?.dish_id;
    const dish = id ? dishById(r, id) : null;
    if (!dish) {
      if (id) invalidDishIds.push(id);
      continue;
    }
    courses.push({
      slot: c.slot ?? dish.course_type,
      dish_id: dish.dish_id,
      name: dish.name,
      course_type: dish.course_type,
      price_cents: dish.price_cents,
      note: c.note ?? null,
    });
  }

  const beverages: ComposedBeverage[] = [];
  for (const b of raw.beverages ?? []) {
    if (b?.beverage_id) {
      const bev = beverageById(r, b.beverage_id);
      if (bev) {
        beverages.push({
          beverage_id: bev.beverage_id,
          name: bev.name,
          type: bev.type,
          pairing_note: b.pairing_note ?? null,
        });
        continue;
      }
      // invalid id -> demote to descriptive rather than drop the suggestion
    }
    if (b?.name) {
      beverages.push({
        beverage_id: null,
        name: b.name,
        type: "descriptive",
        pairing_note: b.pairing_note ?? null,
      });
    }
  }
  return { courses, beverages, invalidDishIds };
}

export function estimateCents(r: Restaurant, v: Validated, fallback: number | undefined): number {
  let total = 0;
  let counted = false;
  for (const c of v.courses) {
    if (c.price_cents != null) {
      total += c.price_cents;
      counted = true;
    }
  }
  for (const b of v.beverages) {
    if (!b.beverage_id) continue;
    const bev = beverageById(r, b.beverage_id);
    const price = bev?.glass_cents ?? bev?.bottle_cents ?? null;
    if (price != null) {
      total += price;
      counted = true;
    }
  }
  // Approximate per-couple total from validated priced items; fall back to the
  // model's estimate when nothing was priced (e.g. experience-led / market-price).
  if (counted) return total;
  return Number.isFinite(fallback) ? Number(fallback) : 0;
}

async function callModel(r: Restaurant, p: ParsedBrief, mode: ComposeMode, correction?: string): Promise<RawComposition> {
  const msg = await anthropic().messages.create({
    model: config.composeModel,
    max_tokens: 1500,
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(r, p, mode, correction) }],
  });
  return parseJsonLoose<RawComposition>(textOf(msg));
}

export async function compose(pick: SpreadPick, parsed: ParsedBrief): Promise<ComposedEvening> {
  const r = pick.restaurant;
  let mode = modeFor(r.menu_completeness);

  let validated: Validated;
  if (mode === "experience-led" || r.dishes.length === 0) {
    // No reliable dish data: one experience-led pass, no dish validation needed.
    mode = "experience-led";
    const raw = await callModel(r, parsed, mode);
    validated = validate(r, raw); // courses will be [] if the model behaved; drop any stragglers
    validated.courses = []; // enforce: zero dish claims in experience-led
    return assemble(pick, parsed, mode, validated, raw.rationale, raw.estimated_cents);
  }

  // tier full/partial: compose, validate ids, retry once on hallucination, then fall back.
  let raw = await callModel(r, parsed, mode);
  validated = validate(r, raw);
  if (validated.invalidDishIds.length > 0) {
    const correction = `These dish_id values are NOT in the menu and were rejected: ${validated.invalidDishIds.join(
      ", "
    )}. Recompose using ONLY dish_id values present in the MENU above.`;
    raw = await callModel(r, parsed, mode, correction);
    validated = validate(r, raw);
  }

  // After retry: if still nothing valid, fall back to experience-led prose.
  if (validated.invalidDishIds.length > 0 && validated.courses.length === 0) {
    mode = "experience-led";
    const raw2 = await callModel(r, parsed, mode);
    const v2 = validate(r, raw2);
    v2.courses = [];
    return assemble(pick, parsed, mode, v2, raw2.rationale, raw2.estimated_cents);
  }

  // If some courses validated but the menu was thin, mark partial.
  if (validated.invalidDishIds.length > 0 && r.menu_completeness === "full") {
    mode = "partial";
  }
  return assemble(pick, parsed, mode, validated, raw.rationale, raw.estimated_cents);
}

export function assemble(
  pick: SpreadPick,
  _parsed: ParsedBrief,
  mode: ComposeMode,
  v: Validated,
  rationale: string | undefined,
  estFallback: number | undefined
): ComposedEvening {
  const r = pick.restaurant;
  return {
    restaurant_id: r.id,
    name: r.name,
    role: pick.role,
    neighborhood: r.neighborhood,
    cuisine: r.cuisine,
    price_tier: r.price_tier,
    brief_line: pick.brief_line,
    rationale: (rationale ?? "").trim(),
    courses: v.courses,
    beverages: v.beverages,
    estimated_cents: estimateCents(r, v, estFallback),
    menu_completeness: r.menu_completeness,
    compose_mode: mode,
  };
}
