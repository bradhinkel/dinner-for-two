// Streaming composer for the web: streams the rationale prose live, then emits a
// validated ComposedEvening (courses/beverages/total) once the JSON tail arrives.
// Reuses the prompt + validation helpers from src/compose/compose.ts.
import { config } from "../config.js";
import { anthropic, guardedCreate, acquireStreamSlot, textOf, parseJsonLoose } from "../llm/anthropic.js";
import {
  modeFor,
  userPrompt,
  validate,
  estimateCents,
  assemble,
  systemPrompt,
  type ComposeMode,
  type RawComposition,
  type Validated,
} from "../compose/compose.js";
import type { ComposedEvening, ParsedBrief, SpreadPick } from "../types.js";

const DELIM = "###MENU###";

const STREAM_SYSTEM = `You compose ONE date-night evening for two at a specific restaurant.

Route on BOTH venue_format and menu_completeness (tier_to_use):
- "full": a balanced multi-course evening from the menu — no key-ingredient repeats, sensible weight progression. shared ordering = one of each course to share; two-entree = shared starter + two distinct entrees + shared dessert. share-plate venue = an ordered run of 4-6 shareable plates, "a meal to share".
- "partial": compose only from the dishes given; narrate gaps at category level; never invent dishes.
- "experience-led": little/no reliable dish data. Make ZERO dish-id claims; courses must be []. Sell the room, the occasion, and at most a known signature/pairing in prose.

HARD RULES: use ONLY items from the menu by their exact dish_id / beverage_id; never invent an item or id; respect dietary constraints; dinner is the spine.

OUTPUT FORMAT — two parts, in this exact order:
1) The rationale: 50-60 words of plain prose, written like someone who has sat in that room (use its vibe/noise/character). No labels, no quotes.
2) On a new line, the literal delimiter ${DELIM}
3) Then a STRICT JSON object (no prose, no fences):
{"compose_mode":"full|partial|experience-led","courses":[{"slot":string,"dish_id":string,"note":string}],"beverages":[{"beverage_id":string|null,"name":string,"type":"wine|beer|cocktail|sake|na|descriptive","pairing_note":string}],"estimated_cents":int}
courses is [] for experience-led. beverage_id null only for a descriptive recommendation when the list is sparse (type "descriptive").`;

export type ComposeEvent =
  | { type: "meta"; restaurant_id: string; role: string; name: string }
  | { type: "rationale"; text: string }
  | { type: "evening"; evening: ComposedEvening }
  | { type: "error"; message: string };

async function retryStrict(
  r: SpreadPick["restaurant"],
  parsed: ParsedBrief,
  mode: ComposeMode,
  correction: string
): Promise<RawComposition> {
  const msg = await guardedCreate({
    model: config.composeModel,
    max_tokens: 1500,
    system: systemPrompt(),
    messages: [{ role: "user", content: userPrompt(r, parsed, mode, correction) }],
  });
  return parseJsonLoose<RawComposition>(textOf(msg));
}

export async function* composeStream(
  pick: SpreadPick,
  parsed: ParsedBrief
): AsyncGenerator<ComposeEvent> {
  const r = pick.restaurant;
  let mode: ComposeMode = modeFor(r.menu_completeness);
  if (r.dishes.length === 0) mode = "experience-led";

  yield { type: "meta", restaurant_id: r.id, role: pick.role, name: r.name };

  let full = "";
  let emitted = 0;
  const releaseSlot = await acquireStreamSlot();
  try {
    const stream = anthropic().messages.stream({
      model: config.composeModel,
      max_tokens: 1500,
      system: STREAM_SYSTEM,
      messages: [{ role: "user", content: userPrompt(r, parsed, mode) }],
    });

    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        full += ev.delta.text;
        const di = full.indexOf(DELIM);
        // Emit rationale up to the delimiter; hold back a tail so a partial
        // delimiter never leaks into the streamed prose.
        const safe = di >= 0 ? di : Math.max(0, full.length - DELIM.length);
        if (safe > emitted) {
          yield { type: "rationale", text: full.slice(emitted, safe) };
          emitted = safe;
        }
      }
    }
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  } finally {
    // Release whether the stream completed, errored, or the client disconnected
    // (abandoning this generator runs its finally). The strict-retry below takes
    // its own slot via guardedCreate, so we don't hold one across it.
    releaseSlot();
  }

  const di = full.indexOf(DELIM);
  const rationale = (di >= 0 ? full.slice(0, di) : full).trim();
  // flush any remaining rationale we held back
  if (di >= 0 && di > emitted) yield { type: "rationale", text: full.slice(emitted, di) };

  let raw: RawComposition = {};
  if (di >= 0) {
    try {
      raw = parseJsonLoose<RawComposition>(full.slice(di + DELIM.length));
    } catch {
      raw = {};
    }
  }

  let validated: Validated = validate(r, raw);
  if (mode !== "experience-led" && validated.invalidDishIds.length > 0) {
    try {
      const retry = await retryStrict(
        r,
        parsed,
        mode,
        `These dish_id values are NOT in the menu and were rejected: ${validated.invalidDishIds.join(
          ", "
        )}. Recompose using ONLY dish_id values present in the MENU.`
      );
      const v2 = validate(r, retry);
      if (v2.courses.length > 0) validated = v2;
    } catch {
      /* keep first-pass validated courses */
    }
  }
  if (mode === "experience-led") validated.courses = [];
  if (validated.invalidDishIds.length > 0 && validated.courses.length === 0) mode = "experience-led";
  else if (validated.invalidDishIds.length > 0 && r.menu_completeness === "full") mode = "partial";

  const evening = assemble(pick, parsed, mode, validated, rationale, raw.estimated_cents);
  yield { type: "evening", evening };
}
