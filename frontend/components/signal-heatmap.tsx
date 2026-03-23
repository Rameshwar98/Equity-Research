"use client";

import * as React from "react";
import type { Signal } from "@/lib/types";
import { cn } from "@/lib/utils";

const BAR_COLOR: Record<Signal, string> = {
  BUY: "bg-emerald-500",
  HOLD: "bg-amber-400",
  SELL: "bg-rose-500",
  "N/A": "bg-zinc-300 dark:bg-zinc-600",
};

function monthLabel(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function SignalHeatmap({
  dateLabels,
  signals,
  closes,
}: {
  dateLabels: string[];
  signals: Signal[];
  closes?: (number | null)[];
}) {
  const [hoveredIdx, setHoveredIdx] = React.useState<number | null>(null);

  const chronoDates = React.useMemo(() => [...dateLabels].reverse(), [dateLabels]);
  const chronoSignals = React.useMemo(() => [...signals].reverse(), [signals]);
  const chronoCloses = React.useMemo(() => (closes ? [...closes].reverse() : []), [closes]);
  const total = chronoDates.length;

  const monthTicks = React.useMemo(() => {
    const ticks: { label: string; position: number }[] = [];
    let last = "";
    for (let i = 0; i < chronoDates.length; i++) {
      const ml = monthLabel(chronoDates[i]);
      if (ml !== last) {
        ticks.push({ label: ml, position: i });
        last = ml;
      }
    }
    return ticks;
  }, [chronoDates]);

  const counts = React.useMemo(() => {
    const c = { BUY: 0, HOLD: 0, SELL: 0, "N/A": 0 };
    chronoSignals.forEach((s) => c[s]++);
    return c;
  }, [chronoSignals]);

  return (
    <div className="space-y-3">
      {/* Hover detail */}
      <div className="h-5 text-xs tabular-nums text-center text-muted-foreground">
        {hoveredIdx !== null ? (
          <>
            <span className="text-foreground font-medium">
              {formatDate(chronoDates[hoveredIdx])}
            </span>
            {chronoCloses[hoveredIdx] != null && (
              <span className="text-foreground">
                {" "}${chronoCloses[hoveredIdx]!.toFixed(2)}
              </span>
            )}
            {" — "}
            <span
              className={cn(
                "font-semibold",
                chronoSignals[hoveredIdx] === "BUY" && "text-emerald-600 dark:text-emerald-400",
                chronoSignals[hoveredIdx] === "SELL" && "text-rose-600 dark:text-rose-400",
                chronoSignals[hoveredIdx] === "HOLD" && "text-amber-600 dark:text-amber-300"
              )}
            >
              {chronoSignals[hoveredIdx]}
            </span>
          </>
        ) : (
          <span className="italic">Hover to inspect</span>
        )}
      </div>

      {/* Bar */}
      <div className="flex w-full overflow-hidden rounded-sm" style={{ height: 28 }}>
        {chronoDates.map((date, i) => (
          <div
            key={date}
            className={cn(
              "h-full transition-opacity duration-75",
              BAR_COLOR[chronoSignals[i] ?? "N/A"],
              hoveredIdx !== null && hoveredIdx !== i && "opacity-40"
            )}
            style={{ width: `${100 / total}%` }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          />
        ))}
      </div>

      {/* Month axis */}
      <div className="relative h-4">
        {monthTicks.map((tick) => (
          <span
            key={tick.label + tick.position}
            className="absolute text-[10px] text-muted-foreground leading-none"
            style={{ left: `${(tick.position / total) * 100}%` }}
          >
            {tick.label}
          </span>
        ))}
      </div>

      {/* Summary */}
      <div className="flex items-center gap-5 text-[11px] tabular-nums text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          {counts.BUY} Buy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" />
          {counts.HOLD} Hold
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
          {counts.SELL} Sell
        </span>
        <span className="ml-auto">{total} days</span>
      </div>
    </div>
  );
}
