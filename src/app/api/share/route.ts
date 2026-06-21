// POST /api/share — mint a share_token for a composed evening; returns the URL.
import { NextRequest, NextResponse } from "next/server";
import { putShare } from "@/server/store";
import type { ComposedEvening } from "@/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const evening = body?.evening as ComposedEvening | undefined;
  if (!evening?.restaurant_id) {
    return NextResponse.json({ error: "evening required" }, { status: 400 });
  }
  const sharedBy = typeof body?.shared_by === "string" && body.shared_by.trim() ? body.shared_by.trim() : "a friend";
  const share = putShare(evening, sharedBy);
  const url = new URL(`/e/${share.token}`, req.nextUrl.origin).toString();
  return NextResponse.json({ token: share.token, url, expires_at: share.expires_at });
}
