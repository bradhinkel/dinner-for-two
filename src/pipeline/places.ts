// Google Places (New) Text Search client — resolves a restaurant to coordinates,
// business_status (open/closed), price level, rating, and address. Used by the
// import enrichment pass for lat/long + the §5 closure signal.
import { config } from "../config.js";

export interface PlaceInfo {
  place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  business_status: string | null; // OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY
  price_level: number | null; // 1..4 (mapped from PRICE_LEVEL_*)
  rating: number | null;
  formatted_address: string | null;
  website: string | null;
  display_name: string | null;
}

const PRICE_MAP: Record<string, number> = {
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.location",
  "places.businessStatus",
  "places.priceLevel",
  "places.rating",
  "places.formattedAddress",
  "places.websiteUri",
].join(",");

export function placesEnabled(): boolean {
  return Boolean(config.googlePlacesApiKey);
}

/** Best-match Place for "name, neighborhood, Seattle, WA". null if no key or no match. */
export async function placesLookup(
  name: string,
  neighborhood: string | null
): Promise<PlaceInfo | null> {
  if (!config.googlePlacesApiKey) return null;
  const textQuery = [name, neighborhood, "Seattle, WA"].filter(Boolean).join(", ");

  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": config.googlePlacesApiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({ textQuery, maxResultCount: 1, languageCode: "en" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Places API ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as any;
  const p = json?.places?.[0];
  if (!p) return null;
  return {
    place_id: p.id ?? null,
    latitude: p.location?.latitude ?? null,
    longitude: p.location?.longitude ?? null,
    business_status: p.businessStatus ?? null,
    price_level: p.priceLevel ? PRICE_MAP[p.priceLevel] ?? null : null,
    rating: typeof p.rating === "number" ? p.rating : null,
    formatted_address: p.formattedAddress ?? null,
    website: p.websiteUri ?? null,
    display_name: p.displayName?.text ?? null,
  };
}
