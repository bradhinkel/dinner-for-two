import type { Metadata } from "next";
import { getShare } from "@/server/store";
import { usd } from "@/lib/api";
import { Wordmark } from "@/components/Wordmark";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const share = getShare(token);

  if (!share || Date.now() > share.expires_at) {
    return (
      <div className="flex min-h-screen flex-col px-6 pb-10 pt-5">
        <Wordmark />
        <hr className="hairline mt-3.5" />
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="display text-[34px]">
            This link has <span className="text-oxblood">expired.</span>
          </h1>
          <p className="mt-4 font-serif text-[17px] italic text-ink-soft">
            Shared evenings last six hours. Ask for a fresh link.
          </p>
        </div>
      </div>
    );
  }

  const e = share.evening;
  const meta = [e.price_tier ? "$".repeat(e.price_tier) : "", e.cuisine, e.neighborhood]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="min-h-screen pb-12">
      {/* banner */}
      <div className="flex items-center justify-between bg-paper-deep px-5 py-3">
        <span className="font-serif text-[14px] italic text-ink-soft">Shared by {share.shared_by}</span>
        <span className="text-[9px] uppercase tracking-label text-ink-mute">awaiting</span>
      </div>

      {/* hero */}
      <div className="candlelit relative h-[260px] w-full">
        <div className="absolute bottom-4 left-5 right-5">
          <div className="label text-paper/70">An evening at</div>
          <h1 className="font-serif text-[44px] italic leading-none text-[#F5F0E5]">{e.name}</h1>
          <div className="mt-1.5 text-[11px] text-paper/80 tnum">{meta}</div>
        </div>
      </div>

      <div className="px-5 pt-5">
        <p className="font-serif text-[19px] italic leading-relaxed text-ink">{e.rationale}</p>

        {e.courses.length > 0 && (
          <div className="mt-6">
            <hr className="hairline" />
            <div className="mt-3 label">The menu · for two</div>
            <ul className="mt-2">
              {e.courses.map((c, i) => (
                <li key={c.dish_id + i} className="grid grid-cols-[28px_1fr_auto] gap-2 border-b border-rule-soft py-2.5">
                  <span className="font-serif text-[15px] italic text-oxblood tnum">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="text-[10px] uppercase tracking-label text-ink-mute">{c.slot}</div>
                    <div className="text-[14px] text-ink">{c.name}</div>
                    {c.note && <div className="mt-0.5 font-serif text-[13px] italic text-ink-soft">{c.note}</div>}
                  </div>
                  <span className="text-[12px] text-ink-soft tnum">{usd(c.price_cents)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {e.beverages.length > 0 && (
          <div className="mt-4 border-t-2 border-oxblood bg-paper-card px-3 py-3">
            <div className="label">To drink</div>
            <ul className="mt-1.5 space-y-1">
              {e.beverages.map((b, i) => (
                <li key={i} className="font-serif text-[15px] italic text-ink">
                  {b.name}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-5">
          <hr className="hairline" />
          <div className="mt-2 flex items-end justify-between">
            <span className="label">Estimated · two</span>
            <span className="display text-[32px] tnum">{usd(e.estimated_cents)}</span>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-2">
          <a
            href={`/`}
            className="btn-ox flex items-center justify-center py-3 text-center"
          >
            Yes — I&rsquo;m in
          </a>
          <a href={`/`} className="btn-outline flex items-center justify-center py-3 text-center">
            Open in app
          </a>
        </div>
        <p className="mt-4 text-center label">link expires in 6h · /e/{token}</p>
      </div>
    </div>
  );
}
