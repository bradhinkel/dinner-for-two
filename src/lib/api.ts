// Client-side API helpers: /api/retrieve and the SSE /api/compose reader.
import type { ComposedEvening, DietaryTag, OrderingModel, SpreadRole } from "@/types";

export interface EveningHeader {
  restaurant_id: string;
  name: string;
  cuisine: string | null;
  neighborhood: string | null;
  price_tier: number | null;
  venue_format: string;
  menu_completeness: string;
  reservation_url: string | null;
  reservation_platform: string | null;
  role: SpreadRole;
  brief_line: string;
  relevance: number;
}

export interface RetrieveResponse {
  spread_id: string;
  evenings: EveningHeader[];
  error?: string;
}

export interface Prefs {
  ordering_model?: OrderingModel;
  drinks?: string[];
  dietary?: DietaryTag[];
  price_max?: number;
  neighborhood?: string;
}

export async function retrieve(brief: string, prefs: Prefs): Promise<RetrieveResponse> {
  const res = await fetch("/api/retrieve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, prefs }),
  });
  const json = await res.json();
  if (json?.error === "no_match") return { spread_id: "", evenings: [], error: "no_match" };
  if (!res.ok) throw new Error(json?.message ?? json?.error ?? `retrieve failed (${res.status})`);
  return json as RetrieveResponse;
}

export interface ComposeHandlers {
  onRationale?: (text: string) => void;
  onEvening?: (evening: ComposedEvening) => void;
  onError?: (message: string) => void;
}

/** Open the SSE compose stream for one restaurant and dispatch events. */
export async function composeEvening(
  spreadId: string,
  restaurantId: string,
  handlers: ComposeHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`/api/compose/${encodeURIComponent(restaurantId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spread_id: spreadId }),
    signal,
  });
  if (!res.ok || !res.body) {
    handlers.onError?.(`compose failed (${res.status})`);
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6);
      let ev: any;
      try {
        ev = JSON.parse(payload);
      } catch {
        continue;
      }
      if (ev.type === "rationale") handlers.onRationale?.(ev.text);
      else if (ev.type === "evening") handlers.onEvening?.(ev.evening as ComposedEvening);
      else if (ev.type === "error") handlers.onError?.(ev.message);
    }
  }
}

export function usd(cents: number | null | undefined): string {
  if (!cents || cents <= 0) return "—";
  return `$${Math.round(cents / 100)}`;
}
