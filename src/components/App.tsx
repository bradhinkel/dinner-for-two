"use client";
import { useCallback, useRef, useState } from "react";
import { BriefScreen } from "./BriefScreen";
import { ComposingScreen } from "./ComposingScreen";
import { EveningCard, type CardState } from "./EveningCard";
import { Wordmark } from "./Wordmark";
import { retrieve, composeEvening, type Prefs } from "@/lib/api";
import type { ComposedCourse } from "@/types";

type Phase = "brief" | "composing" | "results" | "no_match" | "error";

export function App({ roomCount }: { roomCount: number }) {
  const [phase, setPhase] = useState<Phase>("brief");
  const [spreadId, setSpreadId] = useState("");
  const [cards, setCards] = useState<CardState[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [toast, setToast] = useState("");
  const briefRef = useRef("");
  const prefsRef = useRef<Prefs>({});

  const setCard = useCallback((id: string, patch: Partial<CardState>) => {
    setCards((cur) => cur.map((c) => (c.header.restaurant_id === id ? { ...c, ...patch } : c)));
  }, []);

  const streamCard = useCallback(
    (sid: string, restaurantId: string) => {
      let acc = "";
      composeEvening(sid, restaurantId, {
        onRationale: (t) => {
          acc += t;
          setCard(restaurantId, { rationale: acc });
        },
        onEvening: (evening) =>
          setCard(restaurantId, { evening, rationale: evening.rationale || acc, status: "done" }),
        onError: () => setCard(restaurantId, { status: "error" }),
      }).catch(() => setCard(restaurantId, { status: "error" }));
    },
    [setCard]
  );

  const onCompose = useCallback(
    async (brief: string, prefs: Prefs) => {
      briefRef.current = brief;
      prefsRef.current = prefs;
      setPhase("composing");
      setErrorMsg("");
      try {
        const res = await retrieve(brief, prefs);
        if (res.error === "no_match" || res.evenings.length === 0) {
          setPhase("no_match");
          return;
        }
        setSpreadId(res.spread_id);
        setCards(
          res.evenings.map((h) => ({
            header: h,
            rationale: "",
            evening: null,
            status: "composing" as const,
            swappingIndex: null,
          }))
        );
        setPhase("results");
        // Reveal: all headers together, rationale streams into each in parallel.
        for (const h of res.evenings) streamCard(res.spread_id, h.restaurant_id);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [streamCard]
  );

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }, []);

  const onSwapCourse = useCallback(
    async (restaurantId: string, courseIndex: number) => {
      const card = cards.find((c) => c.header.restaurant_id === restaurantId);
      const evening = card?.evening;
      if (!evening) return;
      const course = evening.courses[courseIndex];
      if (!course) return;
      setCard(restaurantId, { swappingIndex: courseIndex });
      try {
        const res = await fetch("/api/swap-course", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            spread_id: spreadId,
            restaurant_id: restaurantId,
            course_index: courseIndex,
            course_type: course.course_type,
            current_dish_ids: evening.courses.map((c) => c.dish_id),
          }),
        });
        const json = await res.json();
        if (res.ok && json.course) {
          setCards((cur) =>
            cur.map((c) => {
              if (c.header.restaurant_id !== restaurantId || !c.evening) return c;
              const courses = c.evening.courses.slice();
              courses[courseIndex] = json.course as ComposedCourse;
              return { ...c, evening: { ...c.evening, courses }, swappingIndex: null };
            })
          );
        } else {
          setCard(restaurantId, { swappingIndex: null });
          flashToast("no other course fits here");
        }
      } catch {
        setCard(restaurantId, { swappingIndex: null });
      }
    },
    [cards, spreadId, setCard, flashToast]
  );

  const onRegenerate = useCallback(
    async (restaurantId: string) => {
      try {
        const res = await fetch("/api/regenerate-evening", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ spread_id: spreadId, restaurant_id: restaurantId }),
        });
        const json = await res.json();
        if (res.ok && json.evening) {
          setCards((cur) =>
            cur.map((c) =>
              c.header.restaurant_id === restaurantId
                ? { header: json.evening, rationale: "", evening: null, status: "composing", swappingIndex: null }
                : c
            )
          );
          streamCard(spreadId, json.evening.restaurant_id);
        } else {
          flashToast("no other room in this spread");
        }
      } catch {
        flashToast("couldn't find another room");
      }
    },
    [spreadId, streamCard, flashToast]
  );

  const onShare = useCallback(
    async (restaurantId: string) => {
      const card = cards.find((c) => c.header.restaurant_id === restaurantId);
      if (!card?.evening) return;
      try {
        const res = await fetch("/api/share", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ evening: card.evening }),
        });
        const json = await res.json();
        if (res.ok && json.url) {
          await navigator.clipboard?.writeText(json.url).catch(() => {});
          flashToast("link copied · expires in 6h");
        }
      } catch {
        flashToast("couldn't make a link");
      }
    },
    [cards, flashToast]
  );

  if (phase === "brief") return <BriefScreen roomCount={roomCount} onCompose={onCompose} />;
  if (phase === "composing") return <ComposingScreen />;

  if (phase === "no_match" || phase === "error") {
    return (
      <div className="flex min-h-screen flex-col px-6 pb-10 pt-5">
        <div className="flex items-center justify-between">
          <Wordmark />
        </div>
        <hr className="hairline mt-3.5" />
        <div className="flex flex-1 flex-col justify-center">
          <h1 className="display text-[36px]">
            Couldn&rsquo;t find a <span className="text-oxblood">fit.</span>
          </h1>
          <p className="mt-4 font-serif text-[17px] italic leading-relaxed text-ink-soft">
            {phase === "no_match"
              ? "Nothing in our set lands on that brief tonight. Widen the price or loosen the mood, and we'll look again."
              : "Something went sideways composing your evenings. Give it another go."}
          </p>
          <button
            onClick={() => setPhase("brief")}
            className="btn-ox mt-7 w-full py-4"
          >
            Widen the brief
          </button>
        </div>
      </div>
    );
  }

  // results
  return (
    <div className="min-h-screen px-4 pb-12 pt-5">
      <div className="flex items-center justify-between px-2">
        <button onClick={() => setPhase("brief")} className="label">
          ← Brief
        </button>
        <span className="label">Three evenings</span>
      </div>
      <hr className="hairline mx-2 mt-3.5" />

      <div className="mt-4 px-2">
        <h1 className="display text-[28px]">
          Your <span className="text-oxblood">spread.</span>
        </h1>
        <p className="mt-1 font-serif text-[14px] italic text-ink-soft">
          Three deliberately different evenings — dependable, adventurous, wildcard.
        </p>
      </div>

      <div className="mt-5 space-y-5">
        {cards.map((c) => (
          <EveningCard
            key={c.header.restaurant_id}
            state={c}
            onSwapCourse={(i) => onSwapCourse(c.header.restaurant_id, i)}
            onRegenerate={() => onRegenerate(c.header.restaurant_id)}
            onShare={() => onShare(c.header.restaurant_id)}
          />
        ))}
      </div>

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 bg-ink px-4 py-2.5 font-serif text-[14px] italic text-paper shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
