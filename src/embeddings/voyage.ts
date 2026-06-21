// Minimal Voyage AI embeddings client (https://docs.voyageai.com).
// Used at build time to embed restaurant descriptions and at query time to embed briefs.
import { config, requireVoyage } from "../config.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

export type EmbedInputType = "document" | "query";

interface VoyageResponse {
  data: { embedding: number[]; index: number }[];
  model: string;
  usage: { total_tokens: number };
}

/** Embed a batch of texts. input_type tunes doc vs query embeddings (asymmetric retrieval). */
export async function embed(
  texts: string[],
  inputType: EmbedInputType
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = requireVoyage();

  const res = await fetch(VOYAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.voyageModel,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voyage API ${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as VoyageResponse;
  // Re-order by index to be safe, then return raw vectors.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedOne(
  text: string,
  inputType: EmbedInputType
): Promise<number[]> {
  const [v] = await embed([text], inputType);
  if (!v) throw new Error("Voyage returned no embedding");
  return v;
}
