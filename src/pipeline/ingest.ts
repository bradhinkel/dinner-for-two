// Acquire + extract a menu end-to-end: fetchMenu (render/PDF) -> extractMenu (Claude)
// -> menu/<slug>.json. Resolves restaurants from data/worklist.json by name/slug.
//
// Run:  tsx src/pipeline/ingest.ts "Stoneburner" "Toulouse Petit" ...
//       tsx src/pipeline/ingest.ts --state blocked        (all blocked rooms)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fetchMenu } from "./fetchMenu.js";
import { extractMenu, extractMenuFromVision } from "./extractMenu.js";

function norm(s: string): string {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface WorkRow {
  name: string;
  url: string;
  cuisine: string;
  neighborhood: string;
  state: string;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const stateFlag = args.includes("--state") ? args[args.indexOf("--state") + 1] : null;
  // --url <u> overrides the worklist URL (e.g. a known menu PDF). Single target only.
  const urlOverride = args.includes("--url") ? args[args.indexOf("--url") + 1] : null;
  const names = args.filter(
    (a) => !a.startsWith("--") && a !== stateFlag && a !== urlOverride
  );

  const rows: WorkRow[] = JSON.parse(readFileSync("data/worklist.json", "utf8"));
  let targets: WorkRow[];
  if (stateFlag) {
    targets = rows.filter((r) => r.state === stateFlag);
  } else if (names.length) {
    const want = new Set(names.map(norm));
    targets = rows.filter((r) => want.has(norm(r.name)));
  } else {
    console.error('Usage: ingest "Restaurant Name" ...   or   --state blocked');
    return;
  }
  if (!targets.length) {
    console.error("No matching rooms in worklist.");
    return;
  }
  console.error(`Ingesting ${targets.length} room(s)...`);

  for (const row of targets) {
    const slug = slugify(row.name);
    if (existsSync(`menu/${slug}.json`)) {
      console.error(`  • ${row.name}: menu/${slug}.json exists — skipping`);
      continue;
    }
    process.stderr.write(`  • ${row.name} … `);
    // Isolate each room: a render/extract failure (e.g. a malformed or truncated
    // LLM response) must not abort the whole batch.
    try {
      const fetchUrl = urlOverride && targets.length === 1 ? urlOverride : row.url;
      const fetched = await fetchMenu(fetchUrl);
      // Route: vision sources (image menu / scanned PDF) -> vision OCR; rendered/PDF
      // text -> text extraction; a hard error with no vision fallback is skipped.
      if (fetched.kind === "error" || (fetched.kind === "pdf-scanned" && !fetched.vision?.length)) {
        console.error(`${fetched.kind} (${fetched.note}) — skipped`);
        continue;
      }
      const extractMeta = {
        name: row.name,
        neighborhood: row.neighborhood || null,
        cuisine: row.cuisine || null,
        source_url: fetched.final_url || row.url,
        extraction_method: fetched.kind === "pdf" ? "pdf (auto)" : "html (rendered)",
      };
      const menu = fetched.vision?.length
        ? await extractMenuFromVision(fetched.vision, extractMeta)
        : await extractMenu(fetched.text, extractMeta);
      writeFileSync(`menu/${slug}.json`, JSON.stringify(menu, null, 2) + "\n");
      const via = fetched.vision?.length ? "vision" : fetched.kind;
      console.error(`${via}: ${menu.dishes.length} dishes, ${menu.beverages.length} bev -> menu/${slug}.json`);
    } catch (e) {
      console.error(`extract error (${e instanceof Error ? e.message : String(e)}) — skipped`);
    }
  }
  console.error("\nDone. Next: npm run enrich -- <slugs> && npm run build:catalog && npm run build:embeddings");
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
