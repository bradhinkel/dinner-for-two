"use client";
import { useEffect, useState } from "react";

const NOTES = [
  { title: "Reading the brief", meta: "mood · cuisine · budget" },
  { title: "Matching the rooms", meta: "Seattle · relevance + diversity" },
  { title: "Sitting down with each menu", meta: "three evenings · for two" },
];

export function ComposingScreen() {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setShown((n) => Math.min(n + 1, NOTES.length)), 700);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex min-h-screen flex-col px-6 pb-10 pt-5">
      <div className="flex items-center justify-between">
        <span className="label">Composing</span>
        <span className="label flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-oxblood" /> live
        </span>
      </div>
      <hr className="hairline mt-3.5" />

      <h1 className="display mt-10 text-[40px]">
        We&rsquo;re composing
        <br />
        <span className="text-oxblood">three evenings</span>
        <br />
        for you.
      </h1>
      <p className="mt-4 font-serif text-[17px] italic leading-relaxed text-ink-soft">
        Reading the brief, matching it against the Seattle rooms, then sitting down with each
        menu. About eight seconds.
      </p>

      <div className="mt-9">
        {NOTES.map((n, i) => (
          <div
            key={n.title}
            className={`flex items-center justify-between border-b border-rule-soft py-3.5 ${
              i < shown ? "animate-fade-up" : "opacity-0"
            }`}
          >
            <div>
              <div className="font-serif text-[17px] italic text-ink">{n.title}</div>
              <div className="label mt-0.5">{n.meta}</div>
            </div>
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                i < shown ? "border-oxblood text-oxblood" : "border-rule text-transparent"
              }`}
            >
              ·
            </span>
          </div>
        ))}
      </div>

      <div className="flex-1" />
      <div className="flex items-center justify-between">
        <span className="label">About 8 seconds</span>
      </div>
    </div>
  );
}
