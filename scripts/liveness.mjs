// Stage 1 — Liveness & viability gate (Restaurant_Finder_Process.md §3).
// Probes each Seattle candidate's URL (cheap, before any extraction) and classifies
// live / live-js / parked / hijacked / private / error. Writes data/worklist.json.
//
// Run:  node scripts/liveness.mjs [--limit N] [--city Seattle]
// Pure Node (global fetch). No API keys needed.
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const args = process.argv.slice(2);
const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const city = args.includes("--city") ? args[args.indexOf("--city") + 1] : "Seattle";
const CONCURRENCY = 8;
const TIMEOUT_MS = 12000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// ---- parse the raw list ----
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function norm(s) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const raw = readFileSync("docs/Raw Restaurant List.txt", "utf8").split(/\r?\n/);
const seen = new Set();
const existing = existsSync("data/restaurants.json")
  ? new Set(JSON.parse(readFileSync("data/restaurants.json", "utf8")).map((r) => norm(r.name)))
  : new Set();

const candidates = [];
for (const line of raw) {
  if (!line.trim() || line.startsWith("Name,URL")) continue;
  const [name, url, cuisine, neighborhood, c, tags, ...vibe] = parseCsvLine(line);
  if (!name || !url) continue;
  if (city && (c || "").trim() !== city) continue;
  const key = norm(name);
  if (seen.has(key)) continue;
  seen.add(key);
  candidates.push({
    name: name.trim(),
    url: url.trim(),
    cuisine: (cuisine || "").trim(),
    neighborhood: (neighborhood || "").trim(),
    city: (c || "").trim(),
    tags: (tags || "").trim(),
    vibe_notes: vibe.join(",").trim(),
    already_in_catalog: existing.has(key),
  });
}

const work = candidates.slice(0, limit);
console.error(`Probing ${work.length} of ${candidates.length} ${city} candidates (concurrency ${CONCURRENCY})...`);

// ---- classification ----
const PARKED = [
  "domain is for sale", "buy this domain", "this domain may be for sale", "domain for sale",
  "hugedomains", "parked free", "courtesy of", "godaddy.com/domains", "sedoparking",
  "domainparking", "is parked", "register4less", "namecheap", "porkbun parked",
];
const SPAM = ["casino", "betting", "gambling", "slot online", "judi", "viagra", "porn", "essay writing"];
const JS_EMPTY = ["enable javascript", "please enable js", "you need to enable javascript"];

function classify({ ok, status, finalUrl, origUrl, text, err, code }) {
  if (err) {
    // DNS failures => domain is gone (genuinely dead). Other failures (TLS, reset,
    // HTTP/2, timeout) are usually Node-fetch quirks or bot walls on LIVE sites —
    // mark 'unreachable' (keep for a browser-grade recheck at extraction).
    if (/ENOTFOUND|EAI_AGAIN|NXDOMAIN|ERR_NAME/i.test(code || err))
      return { state: "error", signal: `dns: ${code || "ENOTFOUND"}` };
    return { state: "unreachable", signal: (code || err || "fetch failed").slice(0, 40) };
  }
  if (status === 401) return { state: "private", signal: "http 401" };
  if (status === 403) return { state: "blocked", signal: "http 403 (bot wall, likely live)" };
  if (status === 404 || status === 410) return { state: "error", signal: `http ${status}` };
  if (status === 429) return { state: "blocked", signal: "http 429 (rate-limited, live)" };
  if (status >= 500) return { state: "unreachable", signal: `http ${status}` };

  const lc = (text || "").toLowerCase();
  const body = lc.slice(0, 20000);
  const origHost = safeHost(origUrl);
  const finalHost = safeHost(finalUrl);
  const offsite = origHost && finalHost && !sameSite(origHost, finalHost);

  if (PARKED.some((p) => body.includes(p))) return { state: "parked", signal: "parking-page text" };
  if (offsite && SPAM.some((p) => body.includes(p))) return { state: "hijacked", signal: `-> ${finalHost} (spam)` };
  if (body.includes("private site") || (body.includes("password") && body.length < 4000))
    return { state: "private", signal: "password/private gate" };

  const textLen = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const jsEmpty = JS_EMPTY.some((p) => body.includes(p)) || textLen < 600;
  const restaurantish = /menu|reservation|reserve|dinner|lunch|hours|book a table|order online/.test(body);

  if (jsEmpty && !restaurantish) {
    if (offsite) return { state: "redirected", signal: `-> ${finalHost}` };
    return { state: "live-js", signal: `sparse/SPA (${textLen} chars)` };
  }
  return { state: offsite ? "redirected" : "live", signal: offsite ? `-> ${finalHost}` : "ok" };
}

function safeHost(u) { try { return new URL(u).host.replace(/^www\./, ""); } catch { return ""; } }
function sameSite(a, b) {
  const reg = (h) => h.split(".").slice(-2).join(".");
  return reg(a) === reg(b);
}

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
    });
  } finally {
    clearTimeout(t);
  }
}

async function probe(cand) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchOnce(cand.url);
      const text = await res.text().catch(() => "");
      const c = classify({ ok: res.ok, status: res.status, finalUrl: res.url, origUrl: cand.url, text });
      return { ...cand, http_status: res.status, final_url: res.url, ...c };
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400)); // brief backoff, then retry once
    }
  }
  const code = lastErr?.cause?.code || lastErr?.code || lastErr?.name;
  const c = classify({
    err: lastErr instanceof Error ? lastErr.message : String(lastErr),
    code,
    origUrl: cand.url,
  });
  return { ...cand, http_status: null, final_url: null, ...c };
}

// ---- run with a small concurrency pool ----
const results = [];
let idx = 0;
async function worker() {
  while (idx < work.length) {
    const i = idx++;
    results[i] = await probe(work[i]);
    if (results[i].state) process.stderr.write(".");
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
process.stderr.write("\n");

// ---- summarize + write ----
const tally = {};
for (const r of results) tally[r.state] = (tally[r.state] || 0) + 1;
const VIABLE = ["live", "live-js", "redirected", "blocked"];
const RECHECK = ["unreachable"]; // browser-grade recheck at extraction; not dead
const DEAD = ["error", "parked", "hijacked", "private"];
const viable = results.filter((r) => VIABLE.includes(r.state) && !r.already_in_catalog);
const recheck = results.filter((r) => RECHECK.includes(r.state) && !r.already_in_catalog);

writeFileSync("data/worklist.json", JSON.stringify(results, null, 2) + "\n");

console.error("\n=== liveness tally ===");
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.error(`  ${k.padEnd(11)} ${v}`);
const deadCount = results.filter((r) => DEAD.includes(r.state)).length;
console.error(`\nviable & new (${VIABLE.join("/")}, not in catalog): ${viable.length}`);
console.error(`needs browser recheck (unreachable, new): ${recheck.length}`);
console.error(`dead/non-viable (${DEAD.join("/")}): ${deadCount}`);
console.error(`already in catalog: ${results.filter((r) => r.already_in_catalog).length}`);
console.error(`wrote data/worklist.json (${results.length} rows)`);
