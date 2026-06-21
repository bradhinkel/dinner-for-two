// Shared types for the Phase 1 engine.

export type VenueFormat =
  | "full-menu"
  | "share-plate"
  | "tasting-only"
  | "counter"
  | "activity";

export type MenuCompleteness = "full" | "partial" | "experience-only";

export type CourseType =
  | "appetizer"
  | "salad"
  | "entree"
  | "dessert"
  | "side"
  | "plate";

export type BeverageType = "wine" | "beer" | "cocktail" | "sake" | "na";

export type DietaryTag = "VEG" | "VEGAN" | "GF";

export type OrderingModel = "shared" | "two-entree";

export type SpreadRole = "dependable" | "adventurous" | "wildcard";

// ---- Menu file shape (menu/*.json on disk) ----

export interface MenuDish {
  course_type: CourseType;
  name: string;
  description: string;
  price_cents: number | null;
  price_note: string | null;
  dietary_tags: DietaryTag[];
  key_ingredients: string[];
  weight_score: number | null;
  richness_score: number | null;
}

export interface MenuBeverage {
  type: BeverageType;
  name: string;
  style: string;
  glass_cents: number | null;
  bottle_cents: number | null;
  region: string | null;
  vintage: string | null;
  flavor_tags: string[];
}

export interface MenuFile {
  restaurant: string;
  neighborhood: string;
  cuisine: string;
  venue_format: VenueFormat;
  menu_completeness: MenuCompleteness;
  source_url: string;
  captured_at: string;
  menu_status: string;
  menu_volatility: string;
  extraction_method: string;
  notes: string;
  dishes: MenuDish[];
  beverages: MenuBeverage[];
}

// ---- Catalog (data/restaurants.json — merged Excel attrs + menu file) ----

// A dish/beverage gains a stable id at catalog-build time, used for dish-ID validation.
export interface Dish extends MenuDish {
  dish_id: string;
}
export interface Beverage extends MenuBeverage {
  beverage_id: string;
}

export interface Restaurant {
  id: string; // slug, == menu file stem
  name: string;
  neighborhood: string | null;
  cuisine: string | null;
  cuisine_tags: string[];
  price_tier: number | null; // 1..4
  vibe_tags: string[];
  noise_level: string | null;
  venue_format: VenueFormat;
  menu_completeness: MenuCompleteness;
  date_night_score: number | null; // 1..5
  description: string | null;
  // dietary availability flags (kitchen can accommodate)
  serves_vegetarian: boolean;
  serves_vegan: boolean;
  serves_gluten_free: boolean;
  reservation_url: string | null;
  reservation_platform: string | null;
  status: "open" | "closed" | "seasonal" | "unverified";
  source_url: string | null;
  menu_volatility: string | null;
  dishes: Dish[];
  beverages: Beverage[];
  // text used to build the embedding (description + tags); kept for transparency
  embed_text: string;
}

export interface EmbeddingRecord {
  id: string;
  model: string;
  dim: number;
  vector: number[];
}

// ---- Parse output ----

export interface ParsedBrief {
  cuisine: string[];
  price_max: number | null; // 1..4
  vibe: string[];
  ordering_model: OrderingModel | null;
  drinks: string[];
  dietary: DietaryTag[];
  party_size: number;
  occasion: string | null;
  neighborhood: string | null;
  activity_intent: string | null;
}

// ---- Retrieval output ----

export interface Candidate {
  restaurant: Restaurant;
  relevance: number; // cosine vs brief, 0..1
}

export interface SpreadPick {
  restaurant: Restaurant;
  role: SpreadRole;
  relevance: number;
  brief_line: string; // <=20w deterministic, NOT llm
}

// ---- Compose output ----

export interface ComposedCourse {
  slot: string; // e.g. "appetizer", "entree", "shared plate"
  dish_id: string;
  name: string;
  course_type: CourseType;
  price_cents: number | null;
  note: string | null; // composer's one-line reasoning for this pick
}

export interface ComposedBeverage {
  beverage_id: string | null; // null when descriptive fallback (sparse list)
  name: string;
  type: BeverageType | "descriptive";
  pairing_note: string | null;
}

export interface ComposedEvening {
  restaurant_id: string;
  name: string;
  role: SpreadRole;
  neighborhood: string | null;
  cuisine: string | null;
  price_tier: number | null;
  brief_line: string;
  rationale: string;
  courses: ComposedCourse[];
  beverages: ComposedBeverage[];
  estimated_cents: number;
  menu_completeness: MenuCompleteness;
  compose_mode: "full" | "partial" | "experience-led"; // actual tier used after validation/fallback
}

export interface Spread {
  spread_id: string;
  brief: string;
  parsed: ParsedBrief;
  evenings: ComposedEvening[];
}
