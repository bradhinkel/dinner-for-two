// Runtime catalog loader — reads the prebuilt data/restaurants.json.
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import type { Restaurant } from "../types.js";

let cache: Restaurant[] | null = null;

export function loadCatalog(): Restaurant[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(readFileSync(config.catalogPath, "utf8")) as Restaurant[];
  } catch {
    throw new Error(
      `Could not read ${config.catalogPath}. Run: python3 scripts/extract_seed.py && npm run build:catalog`
    );
  }
  return cache;
}

export function dishById(r: Restaurant, dishId: string) {
  return r.dishes.find((d) => d.dish_id === dishId) ?? null;
}

export function beverageById(r: Restaurant, beverageId: string) {
  return r.beverages.find((b) => b.beverage_id === beverageId) ?? null;
}
