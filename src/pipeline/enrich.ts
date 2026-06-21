// Stage 4 — Enrichment. For each newly-extracted import (a menu/*.json not covered
// by the Excel seed), derive editorial attributes via an LLM + geo/closure via Places,
// and write them to data/import_attributes.json (merged by buildCatalog).
//
// Run:  tsx src/pipeline/enrich.ts [slug ...]      (default: all un-enriched imports)
// Needs ANTHROPIC_API_KEY; uses GOOGLE_PLACES_API_KEY if present (else geo stays null).
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { anthropic, textOf, parseJsonLoose } from "../llm/anthropic.js";
import { placesLookup, placesEnabled, type PlaceInfo } from "./places.js";
import type { MenuFile } from "../types.js";

function norm(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

interface RawMeta {
  url?: string;
  cuisine?: string;
  neighborhood?: string;
  tags?: string;
  vibe_notes?: string;
}

interface EnrichOut {
  price_tier: number | null;
  vibe_tags: string[];
  noise_level: string | null;
  date_night_score: number | null;
  serves_vegetarian: boolean;
  serves_vegan: boolean;
  serves_gluten_free: boolean;
  description: string;
  reservation_platform: string | null;
  cuisine_secondary: string | null;
}

const SYSTEM = `You are an editor for a curated date-night dining app with a calm, sommelier-like voice. Given a Seattle restaurant's facts and a menu sample, return STRICT JSON describing it. No prose outside the JSON.

{
  "price_tier": 1-4,                 // 1=$ cheap .. 4=$$$$ splurge; reconcile menu prices with any Places price level
  "vibe_tags": string[],             // 3-6 Title-Case tags (e.g. "Romantic","Candlelit","Lively","Waterfront","Patio","Cozy")
  "noise_level": "Quiet"|"Moderate"|"Loud"|null,
  "date_night_score": 1-5,           // how good for a date night (5=exceptional date room)
  "serves_vegetarian": bool,         // can a vegetarian eat well here?
  "serves_vegan": bool,
  "serves_gluten_free": bool,
  "description": string,             // 2-3 sentences, product voice — evoke the room + why it's a date, like a concierge note. No prices.
  "reservation_platform": "OpenTable"|"Resy"|"Tock"|"Walk-in"|null,
  "cuisine_secondary": string|null
}
Use the menu's dietary marks and dish range as evidence. Be honest; don't inflate date_night_score for a loud casual spot. Never invent specific dishes in the description.`;

function menuSample(menu: MenuFile): string {
  const dishes = menu.dishes.slice(0, 14).map((d) => `${d.name}${d.price_cents ? ` ($${Math.round(d.price_cents / 100)})` : ""}`);
  const diet = new Set(menu.dishes.flatMap((d) => d.dietary_tags));
  return JSON.stringify({
    venue_format: menu.venue_format,
    menu_completeness: menu.menu_completeness,
    dish_count: menu.dishes.length,
    dish_sample: dishes,
    dietary_marks_present: [...diet],
  });
}

async function llmEnrich(menu: MenuFile, raw: RawMeta, place: PlaceInfo | null): Promise<EnrichOut> {
  const facts = {
    name: menu.restaurant,
    cuisine: menu.cuisine || raw.cuisine,
    neighborhood: menu.neighborhood || raw.neighborhood,
    discovery_tags: raw.tags,
    discovery_notes: raw.vibe_notes,
    places_rating: place?.rating ?? null,
    places_price_level: place?.price_level ?? null,
    address: place?.formatted_address ?? null,
  };
  const msg = await anthropic().messages.create({
    model: config.composeModel,
    max_tokens: 700,
    system: SYSTEM,
    messages: [
      { role: "user", content: `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nMENU:\n${menuSample(menu)}` },
    ],
  });
  const r = parseJsonLoose<any>(textOf(msg));
  const pt = Number(r?.price_tier);
  const dns = Number(r?.date_night_score);
  return {
    price_tier: Number.isInteger(pt) && pt >= 1 && pt <= 4 ? pt : place?.price_level ?? null,
    vibe_tags: Array.isArray(r?.vibe_tags) ? r.vibe_tags.filter((x: any) => typeof x === "string").slice(0, 6) : [],
    noise_level: ["Quiet", "Moderate", "Loud"].includes(r?.noise_level) ? r.noise_level : null,
    date_night_score: Number.isInteger(dns) && dns >= 1 && dns <= 5 ? dns : null,
    serves_vegetarian: Boolean(r?.serves_vegetarian),
    serves_vegan: Boolean(r?.serves_vegan),
    serves_gluten_free: Boolean(r?.serves_gluten_free),
    description: typeof r?.description === "string" ? r.description.trim() : "",
    reservation_platform:
      typeof r?.reservation_platform === "string" ? r.reservation_platform : null,
    cuisine_secondary: typeof r?.cuisine_secondary === "string" ? r.cuisine_secondary : null,
  };
}

function loadRawMeta(): Record<string, RawMeta> {
  const out: Record<string, RawMeta> = {};
  if (!existsSync("data/worklist.json")) return out;
  const rows = JSON.parse(readFileSync("data/worklist.json", "utf8"));
  for (const r of rows) {
    out[norm(r.name)] = {
      url: r.url,
      cuisine: r.cuisine,
      neighborhood: r.neighborhood,
      tags: r.tags,
      vibe_notes: r.vibe_notes,
    };
  }
  return out;
}

async function main(): Promise<void> {
  const seed = JSON.parse(readFileSync("data/seed_attributes.json", "utf8"));
  const importPath = "data/import_attributes.json";
  const imported: Record<string, any> = existsSync(importPath)
    ? JSON.parse(readFileSync(importPath, "utf8"))
    : {};
  const rawMeta = loadRawMeta();

  const argSlugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const force = process.argv.includes("--force");

  const files = readdirSync("menu").filter((f) => f.endsWith(".json"));
  const targets: { slug: string; menu: MenuFile }[] = [];
  for (const f of files) {
    const slug = f.replace(/\.json$/, "");
    const menu: MenuFile = JSON.parse(readFileSync(join("menu", f), "utf8"));
    const key = norm(menu.restaurant);
    if (argSlugs.length) {
      if (!argSlugs.includes(slug)) continue;
    } else {
      if (seed[key]) continue; // covered by the Excel seed
      if (imported[key] && !force) continue; // already enriched
    }
    targets.push({ slug, menu });
  }

  if (targets.length === 0) {
    console.error("Nothing to enrich (use slugs or --force to re-run).");
    return;
  }
  console.error(`Enriching ${targets.length} import(s). Places: ${placesEnabled() ? "on" : "OFF (geo null)"}`);

  let closed = 0;
  for (const { menu } of targets) {
    const key = norm(menu.restaurant);
    const raw = rawMeta[key] ?? {};
    let place: PlaceInfo | null = null;
    try {
      place = await placesLookup(menu.restaurant, menu.neighborhood || raw.neighborhood || null);
    } catch (e) {
      console.error(`  Places lookup failed for ${menu.restaurant}: ${e instanceof Error ? e.message : e}`);
    }
    const isClosed = (place?.business_status ?? "").toUpperCase().startsWith("CLOSED");
    if (isClosed) closed++;

    const en = await llmEnrich(menu, raw, place);
    imported[key] = {
      name: menu.restaurant,
      neighborhood: menu.neighborhood || raw.neighborhood || null,
      website_url: raw.url || menu.source_url || place?.website || null,
      cuisine_primary: menu.cuisine || raw.cuisine || null,
      cuisine_secondary: en.cuisine_secondary,
      price_tier: en.price_tier,
      tags: raw.tags ? raw.tags.split(";").map((t) => t.trim()).filter(Boolean) : [],
      description: en.description,
      reservation_platform: en.reservation_platform,
      serves_vegetarian: en.serves_vegetarian,
      serves_vegan: en.serves_vegan,
      serves_gluten_free: en.serves_gluten_free,
      ambiance_tags: en.vibe_tags,
      noise_level: en.noise_level,
      date_night_score: en.date_night_score,
      enrichment_status: isClosed ? "Closed (Places)" : "Imported",
      latitude: place?.latitude ?? null,
      longitude: place?.longitude ?? null,
      business_status: place?.business_status ?? null,
      curation: "use",
    };
    console.error(
      `  ✓ ${menu.restaurant} — $${en.price_tier ?? "?"} dns${en.date_night_score ?? "?"} ` +
        `${place ? `(${place.business_status}, ${place.latitude?.toFixed(3)},${place.longitude?.toFixed(3)})` : "(no geo)"}` +
        `${isClosed ? "  ⚠ CLOSED" : ""}`
    );
  }

  writeFileSync(importPath, JSON.stringify(imported, null, 2) + "\n");
  console.error(`\nwrote ${importPath} (${Object.keys(imported).length} total imports)` + (closed ? `; ${closed} flagged CLOSED` : ""));
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
