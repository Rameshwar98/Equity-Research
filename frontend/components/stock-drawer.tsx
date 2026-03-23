"use client";

import * as React from "react";

import { FibPanel } from "@/components/fib-panel";
import { SignalHeatmap } from "@/components/signal-heatmap";
import { SignalTimeline } from "@/components/signal-timeline";
import { TrendBadge } from "@/components/trend-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StockDetailsResponse } from "@/lib/types";

function fmt4(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(4);
}

type TrendView = "heatmap" | "timeline";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t my-4" />;
}

export function StockDrawer({
  open,
  onOpenChange,
  loading,
  error,
  data,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  data: StockDetailsResponse | null;
}) {
  const [trendView, setTrendView] = React.useState<TrendView>("heatmap");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" className="overflow-auto">
        <DialogHeader className="pb-0 mb-1">
          <DialogTitle className="text-lg font-bold tracking-tight">
            {data ? data.symbol : "Stock Details"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {data?.name ?? "Equity analysis"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Loading…
          </div>
        ) : error ? (
          <div className="flex h-32 items-center justify-center text-sm text-destructive">
            {error}
          </div>
        ) : data ? (
          <div className="pr-2">

            {/* ── Key metrics row ── */}
            <div className="mt-3 flex items-end gap-6">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                  Last
                </div>
                <div className="text-2xl font-semibold tabular-nums leading-tight">
                  {data.close?.toFixed(2) ?? "—"}
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-0.5">
                  Signal
                </div>
                <TrendBadge signal={data.signals?.[0] ?? "N/A"} />
              </div>

              <div className="ml-auto flex gap-5 text-right">
                {(["score_1", "score_2", "score_3"] as const).map((k, i) => (
                  <div key={k}>
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                      S{i + 1}
                    </div>
                    <div className="text-sm tabular-nums font-medium leading-tight">
                      {fmt4(data.scores[k])}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Divider />

            {/* ── Signal History ── */}
            <div className="flex items-center justify-between mb-3">
              <SectionLabel>
                Signal History
                <span className="ml-1.5 font-normal normal-case tracking-normal">
                  · {data.date_labels.length} days
                </span>
              </SectionLabel>

              <div className="inline-flex rounded-md border p-0.5 bg-muted/30">
                <button
                  onClick={() => setTrendView("heatmap")}
                  className={cn(
                    "rounded px-2.5 py-0.5 text-[11px] font-medium transition-all",
                    trendView === "heatmap"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Heatmap
                </button>
                <button
                  onClick={() => setTrendView("timeline")}
                  className={cn(
                    "rounded px-2.5 py-0.5 text-[11px] font-medium transition-all",
                    trendView === "timeline"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Timeline
                </button>
              </div>
            </div>

            {trendView === "heatmap" ? (
              <SignalHeatmap dateLabels={data.date_labels} signals={data.signals} closes={data.closes} />
            ) : (
              <SignalTimeline dateLabels={data.date_labels} signals={data.signals} closes={data.closes} />
            )}

            <Divider />

            {/* ── EMAs + Fibonacci side by side ── */}
            <div className="grid grid-cols-2 gap-8">
              <div>
                <SectionLabel>Moving Averages</SectionLabel>
                <div className="space-y-1.5 text-xs">
                  {([
                    ["EMA 10", data.emas.ema_10],
                    ["EMA 20", data.emas.ema_20],
                    ["EMA 30", data.emas.ema_30],
                    ["EMA 50", data.emas.ema_50],
                    ["EMA 100", data.emas.ema_100],
                    ["EMA 200", data.emas.ema_200],
                  ] as const).map(([label, v]) => (
                    <div key={label} className="flex items-center justify-between">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="tabular-nums font-medium">{v?.toFixed(2) ?? "—"}</span>
                    </div>
                  ))}
                  <div className="border-t pt-1.5 mt-1.5 flex items-center justify-between font-medium">
                    <span className="text-muted-foreground">Average</span>
                    <span className="tabular-nums">{data.emas.avg_all_emas?.toFixed(2) ?? "—"}</span>
                  </div>
                </div>
              </div>

              <div>
                <SectionLabel>Fibonacci (52W)</SectionLabel>
                <div className="text-xs">
                  <FibPanel data={data} />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Click a row to load details.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
