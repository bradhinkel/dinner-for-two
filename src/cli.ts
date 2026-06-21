// CLI: npm run engine -- "moderately priced Italian, romantic, we like to share"
//   --json   print only the final Spread JSON (no progress lines)
import { runEngine } from "./engine.js";
import { config } from "./config.js";

function fmtUsd(cents: number): string {
  return cents > 0 ? `$${(cents / 100).toFixed(0)}` : "—";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonOnly = args.includes("--json");
  const brief = args.filter((a) => !a.startsWith("--")).join(" ").trim();

  if (!brief) {
    console.error('Usage: npm run engine -- "your date-night brief"  [--json]');
    process.exit(2);
  }
  if (!config.anthropicApiKey || !config.voyageApiKey) {
    console.error(
      "Missing API keys. Copy .env.example to .env.local and set ANTHROPIC_API_KEY and VOYAGE_API_KEY."
    );
    process.exit(1);
  }

  const log = (s: string) => {
    if (!jsonOnly) console.error(s);
  };

  log(`\nBrief: "${brief}"\n`);
  const spread = await runEngine(brief, {
    onParsed: (p) => log(`Parsed: ${JSON.stringify(p)}\n`),
    onRetrieved: (picks) =>
      log(
        "Spread:\n" +
          picks
            .map(
              (p) =>
                `  [${p.role}] ${p.restaurant.name} (${p.restaurant.venue_format}/${p.restaurant.menu_completeness}, rel=${p.relevance.toFixed(
                  3
                )}) — ${p.brief_line}`
            )
            .join("\n") +
          "\n"
      ),
  });

  if (jsonOnly) {
    console.log(JSON.stringify(spread, null, 2));
    return;
  }

  // Human-readable summary to stderr, full JSON to stdout.
  for (const e of spread.evenings) {
    log(`\n── ${e.role.toUpperCase()}: ${e.name} — ${fmtUsd(e.estimated_cents)} (${e.compose_mode}) ──`);
    log(e.rationale);
    for (const c of e.courses) log(`  • ${c.slot}: ${c.name}${c.price_cents ? ` (${fmtUsd(c.price_cents)})` : ""}`);
    for (const b of e.beverages) log(`  🍷 ${b.name}${b.type === "descriptive" ? " (suggested)" : ""}`);
  }
  log("");
  console.log(JSON.stringify(spread, null, 2));
}

main().catch((err) => {
  console.error("\nError:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
