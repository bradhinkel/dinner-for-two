// Retrieval interface — the seam that contains the Phase 4 in-memory -> pgvector swap.
import type { ParsedBrief, SpreadPick } from "../types.js";
import { InMemoryRetriever } from "./inMemory.js";

export interface Retriever {
  /**
   * Two-stage retrieval: hard filter -> cosine candidate pool -> MMR select 3
   * with dependable/adventurous/wildcard roles. `briefText` is the raw brief,
   * embedded as a query; `parsed` drives the hard filters.
   */
  retrieve(parsed: ParsedBrief, briefText: string): Promise<SpreadPick[]>;
}

export function createRetriever(): Retriever {
  return new InMemoryRetriever();
}
