// POST /api/compose/:restaurantId — SSE stream: rationale tokens, then validated evening.
import { NextRequest } from "next/server";
import { composeStream } from "@/server/composeStream";
import { getSpread } from "@/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ restaurantId: string }> }
) {
  const { restaurantId } = await ctx.params;
  let body: { spread_id?: string };
  try {
    body = await req.json();
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  const spread = body.spread_id ? getSpread(body.spread_id) : undefined;
  if (!spread) return new Response("unknown spread_id", { status: 404 });
  const pick = spread.picks.find((p) => p.restaurant.id === restaurantId);
  if (!pick) return new Response("restaurant not in spread", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of composeStream(pick, spread.parsed)) {
          controller.enqueue(encoder.encode(sse(ev)));
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(sse({ type: "error", message: err instanceof Error ? err.message : String(err) }))
        );
      } finally {
        controller.enqueue(encoder.encode("event: end\ndata: {}\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Tell nginx/other reverse proxies not to buffer this response, so the
      // rationale streams token-by-token even if the proxy's per-route config is
      // missed (see deploy/nginx.conf.example).
      "X-Accel-Buffering": "no",
    },
  });
}
