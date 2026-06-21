// Hit the running dev server: /api/retrieve then SSE /api/compose for one pick.
const BASE = process.env.BASE || "http://localhost:3001";

const r = await fetch(`${BASE}/api/retrieve`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    brief: "moderately priced Italian, romantic, we like to share courses",
    prefs: { ordering_model: "shared", drinks: ["wine"] },
  }),
});
const data = await r.json();
console.log("retrieve status:", r.status);
if (!data.evenings) {
  console.log(JSON.stringify(data));
  process.exit(1);
}
console.log("spread_id:", data.spread_id);
for (const e of data.evenings) {
  console.log(`  [${e.role}] ${e.name} (${e.venue_format}/${e.menu_completeness}) — ${e.brief_line}`);
}

const first = data.evenings[0];
console.log(`\n=== SSE compose: ${first.name} ===`);
const c = await fetch(`${BASE}/api/compose/${first.restaurant_id}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ spread_id: data.spread_id }),
});
const reader = c.body.getReader();
const dec = new TextDecoder();
let buf = "";
let rationale = "";
let evening = null;
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  const frames = buf.split("\n\n");
  buf = frames.pop();
  for (const f of frames) {
    const line = f.split("\n").find((l) => l.startsWith("data: "));
    if (!line) continue;
    let ev;
    try { ev = JSON.parse(line.slice(6)); } catch { continue; }
    if (ev.type === "rationale") rationale += ev.text;
    else if (ev.type === "evening") evening = ev.evening;
    else if (ev.type === "error") console.log("STREAM ERROR:", ev.message);
  }
}
console.log("rationale streamed:", JSON.stringify(rationale.slice(0, 120)) + "...");
console.log("courses:", evening?.courses?.length, "| beverages:", evening?.beverages?.length, "| est:", evening?.estimated_cents, "| mode:", evening?.compose_mode);
for (const co of evening?.courses ?? []) console.log(`   • ${co.slot}: ${co.name}`);
