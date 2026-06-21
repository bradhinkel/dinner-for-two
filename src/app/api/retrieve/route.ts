// POST /api/retrieve — parse + retrieve only (no compose). Target P50 1-2s.
import { NextRequest, NextResponse } from "next/server";
import { parseBrief } from "@/parse/parseBrief";
import { createRetriever } from "@/retrieval/index";
import { putSpread } from "@/server/store";
import type { DietaryTag, OrderingModel, ParsedBrief } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Prefs {
  ordering_model?: OrderingModel;
  drinks?: string[];
  dietary?: DietaryTag[];
  price_max?: number;
  neighborhood?: string;
}

function overlay(parsed: ParsedBrief, prefs?: Prefs): ParsedBrief {
  if (!prefs) return parsed;
  return {
    ...parsed,
    ordering_model: prefs.ordering_model ?? parsed.ordering_model,
    drinks: prefs.drinks && prefs.drinks.length ? prefs.drinks : parsed.drinks,
    dietary: prefs.dietary && prefs.dietary.length ? prefs.dietary : parsed.dietary,
    price_max: prefs.price_max ?? parsed.price_max,
    neighborhood: prefs.neighborhood ?? parsed.neighborhood,
  };
}

export async function POST(req: NextRequest) {
  let body: { brief?: string; prefs?: Prefs };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const brief = (body.brief ?? "").trim();
  if (!brief) return NextResponse.json({ error: "brief is required" }, { status: 400 });

  try {
    const parsed = overlay(await parseBrief(brief), body.prefs);
    const picks = await createRetriever().retrieve(parsed, brief);
    if (picks.length === 0) {
      return NextResponse.json({ error: "no_match" }, { status: 200 });
    }
    const spread = putSpread(brief, parsed, picks);
    return NextResponse.json({
      spread_id: spread.spread_id,
      parsed,
      evenings: picks.map((p) => ({
        restaurant_id: p.restaurant.id,
        name: p.restaurant.name,
        cuisine: p.restaurant.cuisine,
        neighborhood: p.restaurant.neighborhood,
        price_tier: p.restaurant.price_tier,
        venue_format: p.restaurant.venue_format,
        menu_completeness: p.restaurant.menu_completeness,
        reservation_url: p.restaurant.reservation_url,
        reservation_platform: p.restaurant.reservation_platform,
        role: p.role,
        brief_line: p.brief_line,
        relevance: p.relevance,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "engine_error", message }, { status: 500 });
  }
}
