// Acquire + extract a menu end-to-end: fetchMenu (render/PDF) -> extractMenu (Claude)
// -> menu/<slug>.json. Resolves restaurants from data/worklist.json by name/slug.
//
// Run:  tsx src/pipeline/ingest.ts "Stoneburner" "Toulouse Petit" ...
//       tsx src/pipeline/ingest.ts --state blocked        (all blocked rooms)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fetchMenu } from "./fetchMenu.js";
import { extractMenu } from "./extractMenu.js";

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
    const fetchUrl = urlOverride && targets.length === 1 ? urlOverride : row.url;
    const fetched = await fetchMenu(fetchUrl);
    if (fetched.kind === "error" || fetched.kind === "pdf-scanned") {
      console.error(`${fetched.kind} (${fetched.note}) — skipped`);
      continue;
    }
    const menu = await extractMenu(fetched.text, {
      name: row.name,
      neighborhood: row.neighborhood || null,
      cuisine: row.cuisine || null,
      source_url: fetched.final_url || row.url,
      extraction_method: fetched.kind === "pdf" ? "pdf (auto)" : "html (rendered)",
    });
    writeFileSync(`menu/${slug}.json`, JSON.stringify(menu, null, 2) + "\n");
    console.error(`${fetched.kind}: ${menu.dishes.length} dishes, ${menu.beverages.length} bev -> menu/${slug}.json`);
  }
  console.error("\nDone. Next: npm run enrich -- <slugs> && npm run build:catalog && npm run build:embeddings");
}

main().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});
