"use client";
import type { ComposedEvening } from "@/types";
import { usd, type EveningHeader } from "@/lib/api";

export interface CardState {
  header: EveningHeader;
  rationale: string;
  evening: ComposedEvening | null;
  status: "composing" | "done" | "error";
  swappingIndex: number | null;
}

function tierStr(t: number | null): string {
  return t ? "$".repeat(t) : "";
}

function directionsHref(name: string, neighborhood: string | null): string {
  const q = encodeURIComponent(`${name} ${neighborhood ?? ""} Seattle`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

export function EveningCard({
  state,
  onSwapCourse,
  onRegenerate,
  onShare,
}: {
  state: CardState;
  onSwapCourse: (courseIndex: number) => void;
  onRegenerate: () => void;
  onShare: () => void;
}) {
  const { header, rationale, evening, status } = state;
  const meta = [tierStr(header.price_tier), header.cuisine, header.neighborhood]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="overflow-hidden border border-rule bg-paper-card">
      {/* hero */}
      <div className="candlelit relative h-[150px] w-full">
        <div className="absolute left-3 top-3">
          <span className="rounded-full bg-paper/90 px-2.5 py-1 text-[9px] uppercase tracking-label text-ink">
            {header.role}
          </span>
        </div>
        <div className="absolute right-3 top-3">
          <span className="text-[9px] uppercase tracking-label text-paper/80">
            {header.menu_completeness === "experience-only" ? "experience" : header.menu_completeness}
          </span>
        </div>
        <div className="absolute bottom-3 left-4 right-4">
          <div className="text-[9px] uppercase tracking-label text-paper/70">{header.cuisine}</div>
          <h2 className="font-serif text-[34px] italic leading-none text-[#F5F0E5]">{header.name}</h2>
        </div>
      </div>

      {/* address strip */}
      <div className="flex items-center justify-between bg-paper-deep px-4 py-2">
        <span className="text-[11px] text-ink-soft tnum">{meta}</span>
        <span className="text-[9px] uppercase tracking-label text-oxblood">● open</span>
      </div>

      <div className="px-4 pb-5 pt-4">
        <p className="font-serif text-[15px] italic text-ink-soft">{header.brief_line}</p>

        {/* rationale */}
        <div className="mt-4">
          <div className="label">The reasoning</div>
          <p className="mt-1.5 min-h-[3.5em] font-serif text-[17px] italic leading-relaxed text-ink">
            {rationale}
            {status === "composing" && (
              <span className="ml-0.5 inline-block h-[14px] w-[7px] translate-y-[2px] animate-pulse-soft bg-oxblood/70" />
            )}
          </p>
        </div>

        {/* menu */}
        {evening && evening.courses.length > 0 && (
          <div className="mt-5">
            <hr className="hairline" />
            <div className="mt-3 flex items-baseline justify-between">
              <span className="font-serif text-[22px] italic text-ink">The menu</span>
              <span className="label">
                {evening.courses.length} courses · for two
              </span>
            </div>
            <ul className="mt-2">
              {evening.courses.map((c, i) => (
                <li
                  key={c.dish_id + i}
                  className={`grid grid-cols-[28px_1fr_auto] gap-2 border-b border-rule-soft py-2.5 ${
                    state.swappingIndex === i ? "opacity-45" : ""
                  }`}
                >
                  <span className="font-serif text-[15px] italic text-oxblood tnum">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <div className="text-[10px] uppercase tracking-label text-ink-mute">{c.slot}</div>
                    <div className="text-[13px] text-ink">{c.name}</div>
                    {c.note && (
                      <div className="mt-0.5 font-serif text-[13px] italic text-ink-soft">{c.note}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <span className="text-[12px] text-ink-soft tnum">{usd(c.price_cents)}</span>
                    <button
                      aria-label="swap course"
                      onClick={() => onSwapCourse(i)}
                      disabled={state.swappingIndex !== null}
                      className="flex h-[26px] w-[26px] items-center justify-center rounded-full border border-rule text-oxblood disabled:opacity-40"
                    >
                      ↻
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* pairing */}
        {evening && evening.beverages.length > 0 && (
          <div className="mt-4 border-t-2 border-oxblood bg-paper px-3 py-3">
            <div className="label">To drink</div>
            <ul className="mt-1.5 space-y-1.5">
              {evening.beverages.map((b, i) => (
                <li key={i} className="text-[13px] text-ink">
                  <span className="font-serif text-[15px] italic">{b.name}</span>
                  {b.type === "descriptive" && (
                    <span className="ml-1.5 text-[10px] uppercase tracking-label text-ink-mute">
                      suggested
                    </span>
                  )}
                  {b.pairing_note && (
                    <div className="font-serif text-[13px] italic text-ink-soft">{b.pairing_note}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* total */}
        {evening && (
          <div className="mt-4">
            <hr className="hairline" />
            <div className="mt-2 flex items-end justify-between">
              <span className="label">Estimated · two</span>
              <span className="display text-[34px] tnum">{usd(evening.estimated_cents)}</span>
            </div>
          </div>
        )}

        {/* CTAs */}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <a
            href={header.reservation_url ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ox flex items-center justify-center py-3 text-center"
          >
            Reserve{header.reservation_platform ? ` · ${header.reservation_platform}` : ""}
          </a>
          <a
            href={directionsHref(header.name, header.neighborhood)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-outline flex items-center justify-center py-3 text-center"
          >
            Directions
          </a>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={onRegenerate}
            className="font-serif text-[14px] italic text-ink-soft underline decoration-rule underline-offset-2"
          >
            try a different room →
          </button>
          <button
            onClick={onShare}
            disabled={!evening}
            className="font-serif text-[14px] italic text-ink-soft underline decoration-rule underline-offset-2 disabled:opacity-40"
          >
            send to partner →
          </button>
        </div>
      </div>
    </article>
  );
}
