"use client";

function fmt(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

export function Week52RangeBar({
  low,
  high,
  last,
}: {
  low?: number | null;
  high?: number | null;
  last?: number | null;
}) {
  if (low == null || high == null || last == null) {
    return <span className="text-muted-foreground text-[10px] tabular-nums">—</span>;
  }
  if (high <= low) {
    return <span className="text-muted-foreground text-[10px]">—</span>;
  }

  const t = (last - low) / (high - low);
  const pct = Math.max(0, Math.min(100, t * 100));

  return (
    <div
      className="mx-auto w-[min(100%,9.5rem)] min-w-[7.5rem] px-0.5 py-1"
      title={`Last ${fmt(last)} · 52W ${fmt(low)} – ${fmt(high)}`}
    >
      <div className="flex justify-between gap-1 text-[9px] tabular-nums leading-none mb-1">
        <span className="text-rose-600 dark:text-rose-400 font-medium">{fmt(low)}</span>
        <span className="text-emerald-600 dark:text-emerald-400 font-medium">{fmt(high)}</span>
      </div>
      <div className="relative h-4 flex items-center">
        <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-muted-foreground/35" />
        <div
          className="absolute top-1/2 z-10 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-md ring-2 ring-background"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-0.5 flex justify-between text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>52W L</span>
        <span>52W H</span>
      </div>
    </div>
  );
}
