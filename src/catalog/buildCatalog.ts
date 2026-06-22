// Build data/restaurants.json by merging menu/*.json with data/seed_attributes.json.
// Run: npm run build:catalog  (after python3 scripts/extract_seed.py)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import type {
  Beverage,
  Dish,
  MenuFile,
  Restaurant,
} from "../types.js";

interface SeedRow {
  name: string;
  neighborhood: string | null;
  website_url: string | null;
  cuisine_primary: string | null;
  cuisine_secondary: string | null;
  price_tier: number | null;
  tags: string[];
  description: string | null;
  reservation_platform: string | null;
  serves_vegetarian: boolean;
  serves_vegan: boolean;
  serves_gluten_free: boolean;
  ambiance_tags: string[];
  noise_level: string | null;
  date_night_score: number | null;
  enrichment_status: string | null;
  // optional geo/curation fields (populated for imported rows by the enrichment pass)
  latitude?: number | null;
  longitude?: number | null;
  business_status?: string | null;
  curation?: "use" | "hide";
}

// Mirror of scripts/extract_seed.py:norm_name — keep in sync.
function normName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function uniq(xs: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!x) continue;
    const k = x.trim();
    if (k && !seen.has(k.toLowerCase())) {
      seen.add(k.toLowerCase());
      out.push(k);
    }
  }
  return out;
}

function buildEmbedText(name: string, cuisine: string | null, neighborhood: string | null, vibe: string[], description: string | null): string {
  const parts = [
    name,
    cuisine ? `Cuisine: ${cuisine}.` : "",
    neighborhood ? `Neighborhood: ${neighborhood}.` : "",
    vibe.length ? `Vibe: ${vibe.join(", ")}.` : "",
    description ?? "",
  ];
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function buildCatalog(): Restaurant[] {
  const seed: Record<string, SeedRow> = JSON.parse(
    readFileSync("data/seed_attributes.json", "utf8")
  );
  // Imported restaurants carry their attributes in a parallel file written by the
  // enrichment pass (LLM attrs + Places geo/status). Merge it over the Excel seed.
  let imported: Record<string, SeedRow> = {};
  try {
    imported = JSON.parse(readFileSync("data/import_attributes.json", "utf8"));
  } catch {
    /* none yet */
  }
  const attrs: Record<string, SeedRow> = { ...seed, ...imported };

  const files = readdirSync(config.menuDir)
    .filter((f) => f.endsWith(".json"))
    .sort();

  const catalog: Restaurant[] = [];
  const unmatched: string[] = [];

  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const menu: MenuFile = JSON.parse(
      readFileSync(join(config.menuDir, file), "utf8")
    );
    const s = attrs[normName(menu.restaurant)];
    if (!s) unmatched.push(`${menu.restaurant} (${id})`);

    const dishes: Dish[] = menu.dishes.map((d, i) => ({
      ...d,
      dish_id: `${id}-d${i + 1}`,
    }));
    const beverages: Beverage[] = menu.beverages.map((b, i) => ({
      ...b,
      beverage_id: `${id}-b${i + 1}`,
    }));

    const neighborhood = menu.neighborhood || s?.neighborhood || null;
    const cuisine = menu.cuisine || s?.cuisine_primary || null;
    const vibe = uniq([...(s?.ambiance_tags ?? []), ...(s?.tags ?? [])]);
    const description = s?.description ?? null;

    const closedByPlaces = (s?.business_status ?? "").toUpperCase().startsWith("CLOSED");
    const status: Restaurant["status"] =
      closedByPlaces || s?.enrichment_status?.toLowerCase().includes("closed") ? "closed" : "open";

    catalog.push({
      id,
      name: menu.restaurant,
      neighborhood,
      cuisine,
      cuisine_tags: uniq([s?.cuisine_primary, s?.cuisine_secondary, menu.cuisine]),
      price_tier: s?.price_tier ?? null,
      vibe_tags: vibe,
      noise_level: s?.noise_level ?? null,
      venue_format: menu.venue_format,
      menu_completeness: menu.menu_completeness,
      date_night_score: s?.date_night_score ?? null,
      description,
      serves_vegetarian: s?.serves_vegetarian ?? false,
      serves_vegan: s?.serves_vegan ?? false,
      serves_gluten_free: s?.serves_gluten_free ?? false,
      reservation_url: s?.website_url ?? menu.source_url ?? null,
      reservation_platform: s?.reservation_platform ?? null,
      status,
      business_status: s?.business_status ?? null,
      latitude: s?.latitude ?? null,
      longitude: s?.longitude ?? null,
      curation: s?.curation === "hide" ? "hide" : "use",
      source_url: menu.source_url ?? null,
      menu_volatility: menu.menu_volatility ?? null,
      dishes,
      beverages,
      embed_text: buildEmbedText(menu.restaurant, cuisine, neighborhood, vibe, description),
    });
  }

  if (unmatched.length) {
    console.warn(
      `⚠ ${unmatched.length} menu file(s) had no seed-attribute match (using menu-file fields only):\n  - ` +
        unmatched.join("\n  - ")
    );
  }
  return catalog;
}

function main(): void {
  const catalog = buildCatalog();
  writeFileSync(config.catalogPath, JSON.stringify(catalog, null, 2) + "\n");
  const withDishes = catalog.filter((r) => r.dishes.length > 0).length;
  console.log(
    `wrote ${config.catalogPath}: ${catalog.length} restaurants ` +
      `(${withDishes} with dishes), ${catalog.reduce((n, r) => n + r.dishes.length, 0)} dishes`
  );
}

// Run only when invoked directly (tsx src/catalog/buildCatalog.ts).
if (import.meta.url === `file://${process.argv[1]}`) main();
