export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <span className="inline-flex h-[26px] w-[26px] items-center justify-center rounded-full border border-ink font-serif text-[16px] italic text-ink">
        d
      </span>
      <span className="label" style={{ letterSpacing: "0.32em" }}>
        Dinner / Two
      </span>
    </div>
  );
}
