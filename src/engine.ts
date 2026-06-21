// Phase 1 engine: brief -> parse -> retrieve (filter + cosine + MMR) -> compose x3.
import { randomUUID } from "node:crypto";
import { parseBrief } from "./parse/parseBrief.js";
import { createRetriever } from "./retrieval/index.js";
import { compose } from "./compose/compose.js";
import type { ParsedBrief, Spread, SpreadPick } from "./types.js";

export interface EngineHooks {
  onParsed?: (p: ParsedBrief) => void;
  onRetrieved?: (picks: SpreadPick[]) => void;
}

export async function runEngine(brief: string, hooks: EngineHooks = {}): Promise<Spread> {
  const parsed = await parseBrief(brief);
  hooks.onParsed?.(parsed);

  const retriever = createRetriever();
  const picks = await retriever.retrieve(parsed, brief);
  hooks.onRetrieved?.(picks);

  // Compose all three in parallel (bounded LLM cost: only the 3 finalists).
  const evenings = await Promise.all(picks.map((p) => compose(p, parsed)));

  return {
    spread_id: randomUUID(),
    brief,
    parsed,
    evenings,
  };
}
