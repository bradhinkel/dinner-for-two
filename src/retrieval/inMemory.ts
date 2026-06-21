// In-memory two-stage retrieval (project_plan §3). Behind the Retriever interface
// so swapping to Postgres+pgvector in Phase 4 is a contained change.
import { config } from "../config.js";
import { loadCatalog } from "../catalog/loadCatalog.js";
import { loadEmbeddings, cosine } from "../embeddings/store.js";
import { embedOne } from "../embeddings/voyage.js";
import type {
  ParsedBrief,
  Restaurant,
  SpreadPick,
  SpreadRole,
  DietaryTag,
} from "../types.js";
import type { Retriever } from "./index.js";

interface Scored {
  r: Restaurant;
  relevance: number;
  vec: number[];
}

// ---- hard filters (stage 1 gate) ----

function dietaryOk(r: Restaurant, dietary: DietaryTag[]): boolean {
  for (const d of dietary) {
    if (d === "VEGAN" && !r.serves_vegan) return false;
    if (d === "VEG" && !r.serves_vegetarian) return false;
    if (d === "GF" && !r.serves_gluten_free) return false;
  }
  return true;
}

function passesHardFilters(r: Restaurant, p: ParsedBrief): boolean {
  if (r.status !== "open") return false;
  // price ceiling — allow unknown price tiers through (don't punish missing data).
  if (p.price_max != null && r.price_tier != null && r.price_tier > p.price_max)
    return false;
  if (!dietaryOk(r, p.dietary)) return false;
  return true;
}

function neighborhoodMatch(r: Restaurant, neighborhood: string | null): boolean {
  if (!neighborhood || !r.neighborhood) return false;
  const a = r.neighborhood.toLowerCase();
  const b = neighborhood.toLowerCase();
  return a.includes(b) || b.includes(a);
}

// ---- attribute distance (for role assignment: "deliberately different") ----

function jaccardDistance(a: string[], b: string[]): number {
  const sa = new Set(a.map((x) => x.toLowerCase()));
  const sb = new Set(b.map((x) => x.toLowerCase()));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : 1 - inter / union;
}

function attrDistance(a: Restaurant, b: Restaurant): number {
  const cuisine = (a.cuisine ?? "").toLowerCase() === (b.cuisine ?? "").toLowerCase() ? 0 : 1;
  const price =
    a.price_tier != null && b.price_tier != null
      ? Math.abs(a.price_tier - b.price_tier) / 3
      : 0.5;
  const vibe = jaccardDistance(a.vibe_tags, b.vibe_tags);
  const hood = neighborhoodMatch(a, b.neighborhood ?? null) ? 0 : 1;
  // weighted: cuisine and vibe dominate what humans notice as "different".
  return 0.4 * cuisine + 0.3 * vibe + 0.2 * price + 0.1 * hood;
}

// ---- MMR (stage 2 diversity select) ----

function mmrSelect(pool: Scored[], k: number, lambda: number): Scored[] {
  const selected: Scored[] = [];
  const remaining = pool.slice();
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const cand = remaining[i]!;
      let maxSim = 0;
      for (const s of selected) {
        const sim = cosine(cand.vec, s.vec);
        if (sim > maxSim) maxSim = sim;
      }
      const score = lambda * cand.relevance - (1 - lambda) * maxSim;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return selected;
}

// ---- roles + deterministic brief line ----

function assignRoles(picks: Scored[]): { s: Scored; role: SpreadRole }[] {
  if (picks.length === 0) return [];
  // dependable = highest relevance (MMR's first pick).
  const dependable = picks[0]!;
  const rest = picks.slice(1);
  if (rest.length === 0) return [{ s: dependable, role: "dependable" }];
  // wildcard = the remaining pick most attribute-different from dependable.
  rest.sort((a, b) => attrDistance(b.r, dependable.r) - attrDistance(a.r, dependable.r));
  const out: { s: Scored; role: SpreadRole }[] = [{ s: dependable, role: "dependable" }];
  const wildcard = rest[0]!;
  out.push({ s: wildcard, role: "wildcard" });
  for (const x of rest.slice(1)) out.push({ s: x, role: "adventurous" });
  return out;
}

const PRICE_WORD: Record<number, string> = {
  1: "budget-friendly",
  2: "moderately priced",
  3: "upscale",
  4: "splurge-worthy",
};

function clampWords(s: string, max: number): string {
  const w = s.trim().split(/\s+/);
  return w.length <= max ? s.trim() : w.slice(0, max).join(" ");
}

function briefLine(r: Restaurant, p: ParsedBrief): string {
  // Deterministic, <=20 words, from brief<->attribute overlap — NOT an LLM call.
  const vibeMatch = r.vibe_tags.find((t) =>
    p.vibe.some((v) => t.toLowerCase().includes(v.toLowerCase()) || v.toLowerCase().includes(t.toLowerCase()))
  );
  const lead = (vibeMatch ?? r.vibe_tags[0] ?? "").toLowerCase();
  const cuisine = r.cuisine ?? "spot";
  const where = r.neighborhood ? ` in ${r.neighborhood}` : "";
  let line = lead ? `${cap(lead)} ${cuisine}${where}` : `${cuisine}${where}`;

  const tail: string[] = [];
  if (p.price_max != null && r.price_tier != null && r.price_tier <= p.price_max && PRICE_WORD[r.price_tier])
    tail.push(PRICE_WORD[r.price_tier]!);
  if (p.dietary.includes("VEGAN") && r.serves_vegan) tail.push("vegan-friendly");
  else if (p.dietary.includes("VEG") && r.serves_vegetarian) tail.push("vegetarian-friendly");
  if (p.ordering_model === "shared" && r.venue_format === "share-plate") tail.push("built to share");

  if (tail.length) line += ` — ${tail.slice(0, 2).join(", ")}`;
  return clampWords(line.replace(/\s+/g, " ").trim(), 20);
}

function cap(s: string): string {
  return s.length ? s[0]!.toUpperCase() + s.slice(1) : s;
}

// ---- retriever ----

/**
 * Pure selection: hard filter -> cosine pool -> MMR -> roles -> brief line.
 * Takes a precomputed query vector + embedding map so it runs without any API
 * call — the async retriever just supplies the Voyage-embedded query.
 */
export function selectSpread(
  parsed: ParsedBrief,
  qvec: number[],
  catalog: Restaurant[],
  embeddings: Map<string, number[]>
): SpreadPick[] {
  // Hard filter. Apply neighborhood as a hard filter only if it leaves >=3.
  let filtered = catalog.filter((r) => passesHardFilters(r, parsed));
  if (parsed.neighborhood) {
    const hood = filtered.filter((r) => neighborhoodMatch(r, parsed.neighborhood));
    if (hood.length >= 3) filtered = hood;
  }

  // Stage 1: score by cosine vs the brief.
  const scored: Scored[] = [];
  for (const r of filtered) {
    const vec = embeddings.get(r.id);
    if (!vec) continue; // no embedding -> cannot rank; skip
    const relevance = cosine(qvec, vec);
    if (relevance >= config.relevanceFloor) scored.push({ r, relevance, vec });
  }
  scored.sort((a, b) => b.relevance - a.relevance);
  const pool = scored.slice(0, config.candidatePool);

  // Stage 2: MMR diversity select 3, then assign spread roles.
  const picks = mmrSelect(pool, 3, config.mmrLambda);
  const roled = assignRoles(picks);

  return roled.map(({ s, role }) => ({
    restaurant: s.r,
    role,
    relevance: s.relevance,
    brief_line: briefLine(s.r, parsed),
  }));
}

export class InMemoryRetriever implements Retriever {
  async retrieve(parsed: ParsedBrief, briefText: string): Promise<SpreadPick[]> {
    const catalog = loadCatalog();
    const embeddings = loadEmbeddings();
    const qvec = await embedOne(briefText, "query"); // Voyage query embedding
    return selectSpread(parsed, qvec, catalog, embeddings);
  }
}
