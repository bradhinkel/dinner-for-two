"use client";
import { useState } from "react";
import { Wordmark } from "./Wordmark";
import type { OrderingModel } from "@/types";
import type { Prefs } from "@/lib/api";

const PLACEHOLDER =
  "Moderately priced Mexican, romantic and candlelit, we like to share courses. It's our anniversary.";

const DRINKS = ["wine", "cocktails", "beer", "none"] as const;
type Drink = (typeof DRINKS)[number];

function dateLabel(): string {
  const d = new Date();
  const day = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  return `SEA · ${day} ${d.getDate()}`;
}

export function BriefScreen({
  roomCount,
  onCompose,
}: {
  roomCount: number;
  onCompose: (brief: string, prefs: Prefs) => void;
}) {
  const [text, setText] = useState("");
  const [model, setModel] = useState<OrderingModel>("shared");
  const [drink, setDrink] = useState<Drink>("wine");

  function submit() {
    const prefs: Prefs = {
      ordering_model: model,
      drinks: drink === "none" ? [] : [drink],
    };
    onCompose(text.trim() || PLACEHOLDER, prefs);
  }

  return (
    <div className="flex min-h-screen flex-col px-6 pb-8 pt-5">
      <div className="flex items-center justify-between">
        <Wordmark />
        <span className="label tnum">{dateLabel()}</span>
      </div>
      <hr className="hairline mt-3.5" />

      <h1 className="display mt-9 text-[44px]">
        What kind of
        <br />
        <span className="text-oxblood">evening</span> are
        <br />
        you after?
      </h1>

      <div className="mt-8">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          rows={4}
          placeholder={PLACEHOLDER}
          className="w-full resize-none border-0 bg-transparent font-serif text-[22px] italic leading-snug text-ink placeholder:text-ink-mute/60 focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="label">Mood, cuisine, budget — anything</span>
          <span className="label tnum">{text.length} / 500</span>
        </div>
        <hr className="hairline mt-1" />
      </div>

      {/* model toggle */}
      <div className="mt-7 grid grid-cols-2 overflow-hidden border border-ink">
        {([
          ["shared", "Shared courses", "one of each, to share"],
          ["two-entree", "Two entrées", "your own mains"],
        ] as const).map(([val, title, sub], i) => {
          const active = model === val;
          return (
            <button
              key={val}
              onClick={() => setModel(val)}
              className={`px-3 py-3 text-left transition-colors duration-100 ${
                i === 0 ? "border-r border-ink" : ""
              } ${active ? "bg-ink text-paper" : "bg-transparent text-ink"}`}
            >
              <div className="font-serif text-[17px] italic">{title}</div>
              <div className={`mt-0.5 text-[10px] ${active ? "text-paper/70" : "text-ink-mute"}`}>
                {sub}
              </div>
            </button>
          );
        })}
      </div>

      {/* drink pills */}
      <div className="mt-5 flex flex-wrap gap-2">
        {DRINKS.map((d) => {
          const active = drink === d;
          return (
            <button
              key={d}
              onClick={() => setDrink(d)}
              className={`rounded-full border px-4 py-1.5 text-[12px] uppercase tracking-button transition-colors duration-100 ${
                active
                  ? "border-oxblood bg-oxblood text-paper"
                  : "border-rule bg-transparent text-ink-soft"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>

      <div className="flex-1" />

      <button
        onClick={submit}
        className="btn-ink mt-8 flex w-full items-center justify-center gap-3 py-4 active:opacity-90"
      >
        <span>Compose</span>
        <span className="text-paper/60">~ 8 sec</span>
      </button>
      <div className="mt-3 flex items-center justify-between">
        <span className="label">{roomCount} rooms · Seattle</span>
        <span className="label">Verified Q2 / 2026</span>
      </div>
    </div>
  );
}
