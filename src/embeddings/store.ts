// Runtime loader for precomputed embeddings (data/embeddings.json).
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import type { EmbeddingRecord } from "../types.js";

let cache: Map<string, number[]> | null = null;

export function loadEmbeddings(): Map<string, number[]> {
  if (cache) return cache;
  let records: EmbeddingRecord[];
  try {
    records = JSON.parse(readFileSync(config.embeddingsPath, "utf8"));
  } catch {
    throw new Error(
      `Could not read ${config.embeddingsPath}. Run: npm run build:embeddings (needs VOYAGE_API_KEY).`
    );
  }
  cache = new Map(records.map((r) => [r.id, r.vector]));
  return cache;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
