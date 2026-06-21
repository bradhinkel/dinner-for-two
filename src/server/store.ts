// In-memory spread + share store. MVP-scale; survives Next dev HMR via globalThis.
import { randomUUID } from "node:crypto";
import type { ComposedEvening, ParsedBrief, SpreadPick } from "../types.js";

export interface StoredSpread {
  spread_id: string;
  brief: string;
  parsed: ParsedBrief;
  picks: SpreadPick[];
  created_at: number;
}

export interface StoredShare {
  token: string;
  evening: ComposedEvening;
  shared_by: string;
  created_at: number;
  expires_at: number;
}

interface Stores {
  spreads: Map<string, StoredSpread>;
  shares: Map<string, StoredShare>;
}

const g = globalThis as unknown as { __dft_stores?: Stores };
const stores: Stores =
  g.__dft_stores ?? (g.__dft_stores = { spreads: new Map(), shares: new Map() });

export function putSpread(brief: string, parsed: ParsedBrief, picks: SpreadPick[]): StoredSpread {
  const spread: StoredSpread = {
    spread_id: randomUUID(),
    brief,
    parsed,
    picks,
    created_at: Date.now(),
  };
  stores.spreads.set(spread.spread_id, spread);
  return spread;
}

export function getSpread(id: string): StoredSpread | undefined {
  return stores.spreads.get(id);
}

const SHARE_TTL_MS = 6 * 60 * 60 * 1000; // 6h (per spec)
const SHARE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // base32-ish, no ambiguous chars

function shareToken(): string {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += SHARE_ALPHABET[Math.floor(Math.random() * SHARE_ALPHABET.length)];
  }
  return s;
}

export function putShare(evening: ComposedEvening, sharedBy: string): StoredShare {
  const now = Date.now();
  const share: StoredShare = {
    token: shareToken(),
    evening,
    shared_by: sharedBy,
    created_at: now,
    expires_at: now + SHARE_TTL_MS,
  };
  stores.shares.set(share.token, share);
  return share;
}

export function getShare(token: string): StoredShare | undefined {
  return stores.shares.get(token);
}
