// Shared Anthropic client + a small helper to pull text out of a message.
import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropic } from "../config.js";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  // maxRetries: 0 — retries are owned by withRetry() below so there's a single,
  // Retry-After-aware backoff policy instead of two stacked ones.
  if (!client) client = new Anthropic({ apiKey: requireAnthropic(), maxRetries: 0 });
  return client;
}

// ---- Outbound concurrency gate + transient-error retry -----------------------
// A single "generate" fans out to 1 Haiku parse + 3 Sonnet compose streams, so a
// simultaneous burst (even ~10 users) can put 30+ calls in flight and trip
// Anthropic's per-tier rate/concurrency limit (429) or a transient overload
// (529/5xx). The gate caps how many outbound calls run at once (the rest queue);
// withRetry rides out transient failures with exponential backoff + jitter,
// honoring a Retry-After header when present. Tune via env without a redeploy:
//   LLM_MAX_CONCURRENCY (default 8), LLM_MAX_RETRIES (default 4).
const MAX_CONCURRENCY = Math.max(1, Number(process.env.LLM_MAX_CONCURRENCY) || 8);
const MAX_RETRIES = Math.max(0, Number(process.env.LLM_MAX_RETRIES) || 4);

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    if (active < MAX_CONCURRENCY) {
      active++;
      resolve();
    } else {
      waiters.push(resolve);
    }
  });
}

function release(): void {
  const next = waiters.shift();
  if (next) next(); // hand the slot straight to the next waiter (active unchanged)
  else active--; // nobody waiting — free the slot
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isTransient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 529 || (typeof status === "number" && status >= 500 && status < 600))
    return true;
  const code = (err as { code?: string })?.code; // network-level hiccup, no HTTP status
  return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EPIPE";
}

function backoffMs(err: unknown, attempt: number): number {
  const ra = Number((err as { headers?: Record<string, string> })?.headers?.["retry-after"]);
  const jitter = Math.random() * 250;
  if (Number.isFinite(ra) && ra > 0) return ra * 1000 + jitter; // server told us how long
  return Math.min(8000, 500 * 2 ** attempt) + jitter; // 0.5s,1s,2s,4s,8s…
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= MAX_RETRIES || !isTransient(err)) throw err;
      await sleep(backoffMs(err, attempt));
    }
  }
}

/** messages.create() behind the concurrency gate + transient-retry. Use this for
 *  every non-streaming call (parse, compose retry, enrich, extract). */
export async function guardedCreate(
  params: Anthropic.MessageCreateParamsNonStreaming
): Promise<Anthropic.Message> {
  await acquire();
  try {
    return await withRetry(() => anthropic().messages.create(params));
  } finally {
    release();
  }
}

/** Acquire a concurrency slot for a streaming call. The caller MUST invoke the
 *  returned release() in a finally once the stream is consumed or abandoned.
 *  Streams are rate-limited but not mid-stream retried — the gate is what keeps
 *  a burst from tripping 429 at stream start in the first place; a residual 429
 *  surfaces as a stream error the client can regenerate from. */
export async function acquireStreamSlot(): Promise<() => void> {
  await acquire();
  let released = false;
  return () => {
    if (released) return; // idempotent — safe to call from finally even after error
    released = true;
    release();
  };
}

export function textOf(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Parse JSON that may be wrapped in ```json fences or have leading prose. */
export function parseJsonLoose<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let s = (fenced ? fenced[1]! : raw).trim();
  if (!s.startsWith("{") && !s.startsWith("[")) {
    const i = s.search(/[{[]/);
    if (i >= 0) s = s.slice(i);
  }
  // trim trailing non-json after the last closing brace/bracket
  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastBrace >= 0) s = s.slice(0, lastBrace + 1);
  return JSON.parse(s) as T;
}
