// Shared Anthropic client + a small helper to pull text out of a message.
import Anthropic from "@anthropic-ai/sdk";
import { requireAnthropic } from "../config.js";

let client: Anthropic | null = null;

export function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: requireAnthropic() });
  return client;
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
