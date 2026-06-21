// Offline smoke test for the retrieval core (no API keys needed).
// Builds deterministic bag-of-words embeddings so selectSpread runs end-to-end,
// proving hard-filter + cosine + MMR + role assignment + brief lines all work.
// Run: npx tsx scripts/smoke.ts
import { loadCatalog } from "../src/catalog/loadCatalog.js";
import { selectSpread } from "../src/retrieval/inMemory.js";
import type { ParsedBrief } from "../src/types.js";

const DIM = 256;
const STOP = new Set(["the", "a", "an", "and", "in", "of", "with", "to", "for", "on", "is", "it"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function bagEmbed(text: string): number[] {
  const v = new Array(DIM).fill(0);
  for (const t of tokens(text)) v[hash(t) % DIM] += 1;
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

function main(): void {
  const catalog = loadCatalog();
  const embeddings = new Map(catalog.map((r) => [r.id, bagEmbed(r.embed_text)]));

  const cases: { label: string; brief: string; parsed: ParsedBrief }[] = [
    {
      label: "Italian, romantic, share",
      brief: "moderately priced Italian, romantic, candlelit, we like to share pasta and small plates",
      parsed: { cuisine: ["Italian"], price_max: 3, vibe: ["romantic", "candlelit", "intimate"], ordering_model: "shared", drinks: ["wine"], dietary: [], party_size: 2, occasion: null, neighborhood: null, activity_intent: null },
    },
    {
      label: "Seafood, waterfront, splurge",
      brief: "special anniversary, upscale seafood, oysters and crab, lively but a little fancy",
      parsed: { cuisine: ["Seafood"], price_max: 4, vibe: ["lively", "iconic"], ordering_model: "two-entree", drinks: ["cocktails"], dietary: [], party_size: 2, occasion: "anniversary", neighborhood: null, activity_intent: null },
    },
    {
      label: "Vegetarian-friendly, casual",
      brief: "casual vegetarian-friendly dinner, cozy and fun, cocktails",
      parsed: { cuisine: [], price_max: 2, vibe: ["cozy", "casual", "fun"], ordering_model: "shared", drinks: ["cocktails"], dietary: ["VEG"], party_size: 2, occasion: null, neighborhood: null, activity_intent: null },
    },
  ];

  for (const c of cases) {
    const qvec = bagEmbed(c.brief);
    const picks = selectSpread(c.parsed, qvec, catalog, embeddings);
    console.log(`\n### ${c.label}`);
    console.log(`brief: "${c.brief}"`);
    if (picks.length !== 3) console.log(`  ⚠ expected 3 picks, got ${picks.length}`);
    const names = new Set(picks.map((p) => p.restaurant.id));
    if (names.size !== picks.length) console.log("  ⚠ duplicate restaurant in spread!");
    for (const p of picks) {
      console.log(
        `  [${p.role.padEnd(11)}] ${p.restaurant.name} ` +
          `(${p.restaurant.cuisine}, $${p.restaurant.price_tier ?? "?"}, ${p.restaurant.venue_format}/${p.restaurant.menu_completeness}, rel=${p.relevance.toFixed(3)})`
      );
      console.log(`               “${p.brief_line}” (${p.brief_line.split(/\s+/).length}w)`);
    }
  }
  console.log("\n✓ retrieval core ran offline (filter + cosine + MMR + roles + brief lines).");
}

main();
