// POST /api/swap-course — replace one course with a different real dish of the
// same course_type (deterministic, no LLM; fast). { course } or { course: null }.
import { NextRequest, NextResponse } from "next/server";
import { loadCatalog } from "@/catalog/loadCatalog";
import { getSpread } from "@/server/store";
import type { ComposedCourse, CourseType } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  const { spread_id, restaurant_id, course_type, current_dish_ids } = body as {
    spread_id?: string;
    restaurant_id?: string;
    course_type?: CourseType;
    current_dish_ids?: string[];
  };

  const spread = spread_id ? getSpread(spread_id) : undefined;
  if (!spread) return NextResponse.json({ error: "unknown spread" }, { status: 404 });
  const restaurant = loadCatalog().find((r) => r.id === restaurant_id);
  if (!restaurant) return NextResponse.json({ error: "unknown restaurant" }, { status: 404 });

  const used = new Set(current_dish_ids ?? []);
  const alts = restaurant.dishes.filter(
    (d) => d.course_type === course_type && !used.has(d.dish_id)
  );
  if (alts.length === 0) return NextResponse.json({ course: null });

  // rotate deterministically off the count of already-used dishes for variety
  const pick = alts[used.size % alts.length]!;
  const course: ComposedCourse = {
    slot: pick.course_type,
    dish_id: pick.dish_id,
    name: pick.name,
    course_type: pick.course_type,
    price_cents: pick.price_cents,
    note: null,
  };
  return NextResponse.json({ course });
}
