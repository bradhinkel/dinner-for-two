// Precompute description embeddings for every restaurant and write data/embeddings.json.
// Run: npm run build:embeddings   (needs VOYAGE_API_KEY; safe to re-run, output is checked in)
import { writeFileSync } from "node:fs";
import { config } from "../config.js";
import { loadCatalog } from "../catalog/loadCatalog.js";
import { embed } from "./voyage.js";
import type { EmbeddingRecord } from "../types.js";

async function main(): Promise<void> {
  const catalog = loadCatalog();
  const texts = catalog.map((r) => r.embed_text);

  console.log(
    `Embedding ${catalog.length} restaurants with ${config.voyageModel} ...`
  );
  const vectors = await embed(texts, "document");

  const records: EmbeddingRecord[] = catalog.map((r, i) => {
    const vec = vectors[i];
    if (!vec) throw new Error(`Missing embedding for ${r.id}`);
    return { id: r.id, model: config.voyageModel, dim: vec.length, vector: vec };
  });

  writeFileSync(config.embeddingsPath, JSON.stringify(records) + "\n");
  console.log(
    `wrote ${config.embeddingsPath}: ${records.length} vectors, dim=${records[0]?.dim}`
  );
}

main().catch((err) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
