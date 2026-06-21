// POST /api/regenerate-evening — swap one slot for the next-best room not already
// in the spread (keeps its role). Returns a fresh header; client re-streams compose.
import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/catalog/loadCatalog";
import { loadEmbeddings } from "@/embeddings/store";
import { embedOne } from "@/embeddings/voyage";
import { rankCandidates } from "@/retrieval/inMemory";
import { getSpread } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const { spread_id, restaurant_id } = body as { spread_id?: string; restaurant_id?: string };

  const spread = spread_id ? getSpread(spread_id) : undefined;
  if (!spread) return NextResponse.json({ error: "unknown spread" }, { status: 404 });
  const oldPick = spread.picks.find((p) => p.restaurant.id === restaurant_id);
  if (!oldPick) return NextResponse.json({ error: "not in spread" }, { status: 404 });

  const currentIds = new Set(spread.picks.map((p) => p.restaurant.id));
  const qvec = await embedOne(spread.brief, "query");
  const ranked = rankCandidates(spread.parsed, qvec, loadCatalog(), loadEmbeddings());
  const next = ranked.find((c) => !currentIds.has(c.restaurant.id));
  if (!next) return NextResponse.json({ error: "no_alternative" }, { status: 200 });

  // Update the stored spread so compose() can find the new pick and future
  // regenerations exclude it too.
  oldPick.restaurant = next.restaurant;
  oldPick.relevance = next.relevance;
  oldPick.brief_line = next.brief_line;

  const r = next.restaurant;
  return NextResponse.json({
    evening: {
      restaurant_id: r.id,
      name: r.name,
      cuisine: r.cuisine,
      neighborhood: r.neighborhood,
      price_tier: r.price_tier,
      venue_format: r.venue_format,
      menu_completeness: r.menu_completeness,
      reservation_url: r.reservation_url,
      reservation_platform: r.reservation_platform,
      role: oldPick.role,
      brief_line: next.brief_line,
      relevance: next.relevance,
    },
  });
}
