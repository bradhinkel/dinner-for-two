// parse(brief) — Haiku extracts structured fields from a natural-language brief.
import { config } from "../config.js";
import { guardedCreate, textOf, parseJsonLoose } from "../llm/anthropic.js";
import type { DietaryTag, OrderingModel, ParsedBrief } from "../types.js";

const SYSTEM = `You extract structured fields from a date-night dining brief. Return STRICT JSON only — no prose, no code fences.

Schema:
{
  "cuisine": string[],            // cuisines/food styles mentioned (e.g. ["Italian"]); [] if none
  "price_max": int|null,          // budget ceiling as a tier 1-4 (1=$ cheap, 2=$$ moderate, 3=$$$ upscale, 4=$$$$ splurge), inferred from budget language; null if unstated
  "vibe": string[],               // mood/ambiance words (romantic, lively, intimate, cozy, waterfront, ...); [] if none
  "ordering_model": "shared"|"two-entree"|null,  // "shared" if they like to share/taste broadly; "two-entree" if they want their own entrees; null if unstated
  "drinks": string[],             // drink prefs (wine, cocktails, beer, sake, none); [] if none
  "dietary": string[],            // ONLY from this set: "VEG","VEGAN","GF"; [] if none
  "party_size": int,              // default 2
  "occasion": string|null,        // anniversary, birthday, first date, ...; null if unstated
  "neighborhood": string|null,    // Seattle neighborhood if named; null otherwise
  "activity_intent": string|null  // non-dinner activity wish (show, games, waterfront walk); null otherwise
}

Rules: use null/[] for anything not stated. Do NOT invent constraints. Map budget words: "cheap/casual"->1, "moderate/mid"->2, "nice/upscale"->3, "fancy/splurge/special"->4. Only emit dietary tokens from the allowed set.`;

const ALLOWED_DIETARY: DietaryTag[] = ["VEG", "VEGAN", "GF"];

function coerce(raw: any): ParsedBrief {
  const arr = (x: any): string[] =>
    Array.isArray(x) ? x.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : [];
  const dietary = arr(raw?.dietary)
    .map((d) => d.toUpperCase())
    .filter((d): d is DietaryTag => (ALLOWED_DIETARY as string[]).includes(d));
  const om = raw?.ordering_model;
  const ordering_model: OrderingModel | null =
    om === "shared" || om === "two-entree" ? om : null;
  const priceRaw = Number(raw?.price_max);
  const price_max =
    Number.isInteger(priceRaw) && priceRaw >= 1 && priceRaw <= 4 ? priceRaw : null;
  const psize = Number(raw?.party_size);

  return {
    cuisine: arr(raw?.cuisine),
    price_max,
    vibe: arr(raw?.vibe),
    ordering_model,
    drinks: arr(raw?.drinks),
    dietary,
    party_size: Number.isInteger(psize) && psize > 0 ? psize : 2,
    occasion: typeof raw?.occasion === "string" ? raw.occasion : null,
    neighborhood: typeof raw?.neighborhood === "string" ? raw.neighborhood : null,
    activity_intent: typeof raw?.activity_intent === "string" ? raw.activity_intent : null,
  };
}

export async function parseBrief(brief: string): Promise<ParsedBrief> {
  const msg = await guardedCreate({
    model: config.parseModel,
    max_tokens: 400,
    system: SYSTEM,
    messages: [{ role: "user", content: `Brief: «${brief}»` }],
  });
  return coerce(parseJsonLoose<any>(textOf(msg)));
}
