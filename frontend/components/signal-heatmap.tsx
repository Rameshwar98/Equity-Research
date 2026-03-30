"use client";

import * as React from "react";
import type { Signal, StockDetailsResponse } from "@/lib/types";
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

/** Cap month labels so they do not overlap on narrow layouts (~1 year of weekly data). */
function subsampleMonthTicks(
  ticks: { label: string; position: number }[],
  maxShow: number,
): { label: string; position: number }[] {
  if (ticks.length <= maxShow) return ticks;
  const out: { label: string; position: number }[] = [];
  for (let k = 0; k < maxShow; k++) {
    const idx = Math.round((k / (maxShow - 1)) * (ticks.length - 1));
    out.push(ticks[idx]!);
  }
  const seen = new Set<number>();
  return out.filter((t) => {
    if (seen.has(t.position)) return false;
    seen.add(t.position);
    return true;
  });
}

type ChartPoint = NonNullable<StockDetailsResponse["chart_data"]>[number];

/** Above this multiple of 20D average volume, cell uses spike color. */
const VOL_SPIKE_RATIO = 1.25;

function volRatioCellClass(ratio: number | undefined): string {
  if (ratio == null || Number.isNaN(ratio)) {
    return "bg-zinc-200 dark:bg-zinc-700";
  }
  if (ratio >= VOL_SPIKE_RATIO) {
    return "bg-amber-500 dark:bg-amber-500";
  }
  return "bg-slate-400 dark:bg-slate-600";
}

export function SignalHeatmap({
  dateLabels,
  signals,
  closes,
  chartData,
  syncHoverDate,
  onSyncHoverDate,
}: {
  dateLabels: string[];
  signals: Signal[];
  closes?: (number | null)[];
  chartData?: ChartPoint[];
  /** ISO date from price chart tooltip — highlights the same day on the strips. */
  syncHoverDate?: string | null;
  /** When provided, hover state is shared with the chart (parent-owned). */
  onSyncHoverDate?: (date: string | null) => void;
}) {
  const [localHoveredIdx, setLocalHoveredIdx] = React.useState<number | null>(null);
  const linked = onSyncHoverDate != null;

  const chronoDates = React.useMemo(() => [...dateLabels].reverse(), [dateLabels]);
  const chronoSignals = React.useMemo(() => [...signals].reverse(), [signals]);
  const chronoCloses = React.useMemo(() => (closes ? [...closes].reverse() : []), [closes]);
  const total = chronoDates.length;

  const volMap = React.useMemo(() => {
    if (!chartData) return null;
    const m = new Map<string, { volRatio: number; volume: number; volEma5: number }>();
    for (const pt of chartData) {
      if (pt.volRatio != null) {
        m.set(pt.date, {
          volRatio: pt.volRatio,
          volume: pt.volume ?? 0,
          volEma5: pt.volEma5 ?? 0,
        });
      }
    }
    return m.size > 0 ? m : null;
  }, [chartData]);

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

  const displayMonthTicks = React.useMemo(() => {
    const n = monthTicks.length;
    if (n === 0) return [];
    const maxShow = total <= 40 ? 8 : total <= 65 ? 6 : 5;
    return subsampleMonthTicks(monthTicks, maxShow);
  }, [monthTicks, total]);

  const counts = React.useMemo(() => {
    const c = { BUY: 0, HOLD: 0, SELL: 0, "N/A": 0 };
    chronoSignals.forEach((s) => c[s]++);
    return c;
  }, [chronoSignals]);

  const hoveredIdx = React.useMemo(() => {
    if (linked) {
      if (syncHoverDate == null) return null;
      const i = chronoDates.indexOf(syncHoverDate);
      return i >= 0 ? i : null;
    }
    return localHoveredIdx;
  }, [linked, syncHoverDate, chronoDates, localHoveredIdx]);

  const hoveredVol = React.useMemo(() => {
    if (hoveredIdx == null || !volMap) return null;
    return volMap.get(chronoDates[hoveredIdx]) ?? null;
  }, [hoveredIdx, volMap, chronoDates]);

  const setStripHover = (i: number | null) => {
    if (linked) {
      onSyncHoverDate!(i == null ? null : chronoDates[i] ?? null);
    } else {
      setLocalHoveredIdx(i);
    }
  };

  const stripMouseLeave = linked ? () => onSyncHoverDate!(null) : undefined;

  return (
    <div className="space-y-3">
      {/* Hover detail */}
      <div className="min-h-[1.5rem] text-sm tabular-nums text-center text-muted-foreground leading-snug">
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
            {hoveredVol && (
              <span className="text-muted-foreground">
                {" · "}{((hoveredVol.volume) / 1e6).toFixed(1)}M ({hoveredVol.volRatio.toFixed(1)}x)
              </span>
            )}
          </>
        ) : (
          <span className="italic">Hover to inspect</span>
        )}
      </div>

      {/* Signal Bar + vol strip: shared pointer leave clears chart-linked hover */}
      <div onMouseLeave={stripMouseLeave}>
        <div>
          <div className="text-[10px] sm:text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wide">Signal</div>
          <div className="flex w-full overflow-hidden rounded-md" style={{ height: 28 }}>
            {chronoDates.map((date, i) => (
              <div
                key={date}
                className={cn(
                  "h-full transition-opacity duration-75",
                  BAR_COLOR[chronoSignals[i] ?? "N/A"],
                  hoveredIdx !== null && hoveredIdx !== i && "opacity-40"
                )}
                style={{ width: `${100 / total}%` }}
                onMouseEnter={() => setStripHover(i)}
                onMouseLeave={linked ? undefined : () => setStripHover(null)}
              />
            ))}
          </div>
        </div>

        {/* Volume EMA5 Heatmap Strip */}
        {volMap && (
          <div className="mt-3">
            <div className="text-[10px] sm:text-xs text-muted-foreground font-semibold mb-1 uppercase tracking-wide">Vol vs 20D Avg</div>
            <div className="flex w-full overflow-hidden rounded-md" style={{ height: 26 }}>
              {chronoDates.map((date, i) => {
                const v = volMap.get(date);
                const ratio = v?.volRatio;
                return (
                  <div
                    key={date}
                    className={cn(
                      "h-full transition-opacity duration-75",
                      volRatioCellClass(ratio),
                      hoveredIdx !== null && hoveredIdx !== i && "opacity-40"
                    )}
                    style={{ width: `${100 / total}%` }}
                    onMouseEnter={() => setStripHover(i)}
                    onMouseLeave={linked ? undefined : () => setStripHover(null)}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-center gap-5 mt-1.5 text-[10px] sm:text-xs text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <span className="inline-block w-3 h-1.5 rounded-sm bg-slate-400 dark:bg-slate-600" />
                Avg (≤{VOL_SPIKE_RATIO}x)
              </span>
              <span className="flex items-center gap-0.5">
                <span className="inline-block w-3 h-1.5 rounded-sm bg-amber-500" />
                Spike (&gt;{VOL_SPIKE_RATIO}x)
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Month axis — subsampled + centered to avoid crushed/overlapping labels */}
      <div className="relative mt-0.5 min-h-[2.25rem] sm:min-h-[2rem]">
        {displayMonthTicks.map((tick) => {
          const pct = total > 0 ? (tick.position / total) * 100 : 0;
          const atStart = pct < 8;
          const atEnd = pct > 92;
          return (
            <span
              key={`${tick.position}-${tick.label}`}
              className={cn(
                "absolute top-0 text-[10px] sm:text-[11px] text-muted-foreground leading-tight whitespace-nowrap select-none",
                atStart && "translate-x-0 text-left",
                !atStart && !atEnd && "-translate-x-1/2 text-center",
                atEnd && "-translate-x-full text-right"
              )}
              style={{ left: atStart ? 0 : atEnd ? "100%" : `${pct}%` }}
            >
              {tick.label}
            </span>
          );
        })}
      </div>

      {/* Summary */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs sm:text-sm tabular-nums text-muted-foreground pt-1">
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
