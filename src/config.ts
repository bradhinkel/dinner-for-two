// Central config + env loading. Tunables overridable via .env.local.
import "dotenv/config";
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";

// Load .env.local explicitly (dotenv/config only reads .env by default).
if (existsSync(".env.local")) loadEnv({ path: ".env.local", override: true });

function num(name: string, fallback: number): number {
  const v = process.env[name];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  voyageApiKey: process.env.VOYAGE_API_KEY ?? "",

  // Models — latest Claude tiers (see CLAUDE.md / project_plan §1).
  parseModel: process.env.PARSE_MODEL ?? "claude-haiku-4-5-20251001",
  composeModel: process.env.COMPOSE_MODEL ?? "claude-sonnet-4-6",
  voyageModel: process.env.VOYAGE_MODEL ?? "voyage-4-lite",

  // Retrieval tunables (project_plan §3).
  mmrLambda: num("MMR_LAMBDA", 0.7), // relevance vs diversity weight
  candidatePool: num("CANDIDATE_POOL", 24), // stage-1 pool size before MMR
  relevanceFloor: num("RELEVANCE_FLOOR", 0.0), // min cosine to enter pool

  // Paths.
  catalogPath: "data/restaurants.json",
  embeddingsPath: "data/embeddings.json",
  menuDir: "menu",
  seedXlsx: "docs/Seattle_Restaurants_Enriched.xlsx",
} as const;

export function requireAnthropic(): string {
  if (!config.anthropicApiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Copy .env.example to .env.local and add your key."
    );
  }
  return config.anthropicApiKey;
}

export function requireVoyage(): string {
  if (!config.voyageApiKey) {
    throw new Error(
      "VOYAGE_API_KEY is not set. Copy .env.example to .env.local and add your key (dash.voyageai.com)."
    );
  }
  return config.voyageApiKey;
}
