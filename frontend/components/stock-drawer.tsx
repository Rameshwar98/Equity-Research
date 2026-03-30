"use client";

import * as React from "react";

import { FibPanel } from "@/components/fib-panel";
import { PeerComparisonTable } from "@/components/peer-comparison-table";
import { QuarterlyFinancialsPanel } from "@/components/quarterly-financials-panel";
import { PriceChart } from "@/components/price-chart";
import { SignalHeatmap } from "@/components/signal-heatmap";
import { SignalTimeline } from "@/components/signal-timeline";
import { TrendBadge } from "@/components/trend-badge";
import { getStockPeers } from "@/lib/api";
import type { PeerRow, PeersResponse } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ScoreKey, StockDetailsResponse } from "@/lib/types";

function fmt4(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(4);
}

type TrendView = "heatmap" | "timeline";

/** Client-selectable drawer structure; persisted in localStorage. */
export type StockDrawerLayout = "split" | "stacked" | "chart_top";

const DRAWER_LAYOUT_STORAGE_KEY = "equity-stock-drawer-layout";

const DRAWER_LAYOUTS: {
  id: StockDrawerLayout;
  label: string;
  title: string;
}[] = [
  {
    id: "split",
    label: "Split",
    title: "Fundamentals & peers (left) · Chart, signals, Fib (right)",
  },
  {
    id: "stacked",
    label: "Stacked",
    title: "Single column: chart, signals & Fib, then fundamentals & peers",
  },
  {
    id: "chart_top",
    label: "Chart+",
    title: "Full-width chart under header, then two columns below",
  },
];

function DrawerLayoutPicker({
  value,
  onChange,
}: {
  value: StockDrawerLayout;
  onChange: (v: StockDrawerLayout) => void;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 sm:items-end"
      role="group"
      aria-label="Drawer layout"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Layout
      </span>
      <div className="inline-flex rounded-lg border border-border/80 bg-muted/30 p-1">
        {DRAWER_LAYOUTS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            title={opt.title}
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-xs font-medium transition-all sm:px-3",
              value === opt.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-xs sm:text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2.5 leading-snug",
        className
      )}
    >
      {children}
    </div>
  );
}

function Divider() {
  return <div className="border-t border-border/80 my-6" />;
}

const SCORE_LABELS: Record<ScoreKey, string> = {
  score_1: "Score 1",
  score_2: "Score 2",
  score_3: "Score 3",
};

export function StockDrawer({
  open,
  onOpenChange,
  loading,
  error,
  data,
  selectedScore = "score_3",
  indexName = "sp500",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  error: string | null;
  data: StockDetailsResponse | null;
  selectedScore?: ScoreKey;
  /** Universe used for same-sector peers */
  indexName?: string;
}) {
  const [trendView, setTrendView] = React.useState<TrendView>("heatmap");
  const [peers, setPeers] = React.useState<PeerRow[]>([]);
  const [peersSector, setPeersSector] = React.useState<string | null>(null);
  const [peerSource, setPeerSource] = React.useState<string | null>(null);
  const [peersLoading, setPeersLoading] = React.useState(false);
  const [peersError, setPeersError] = React.useState<string | null>(null);
  const [drawerLayout, setDrawerLayout] = React.useState<StockDrawerLayout>("split");
  /** Shared ISO date when heatmap + price chart hover are linked (heatmap view only). */
  const [chartHeatSyncDate, setChartHeatSyncDate] = React.useState<string | null>(null);

  React.useEffect(() => {
    setChartHeatSyncDate(null);
  }, [open, data?.symbol, trendView]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAWER_LAYOUT_STORAGE_KEY);
      if (raw === "split" || raw === "stacked" || raw === "chart_top") {
        setDrawerLayout(raw);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setDrawerLayoutPersist = React.useCallback((next: StockDrawerLayout) => {
    setDrawerLayout(next);
    try {
      localStorage.setItem(DRAWER_LAYOUT_STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    if (!open || !data?.symbol || indexName === "custom") {
      setPeers([]);
      setPeersSector(null);
      setPeerSource(null);
      setPeersError(null);
      setPeersLoading(false);
      return;
    }
    let cancelled = false;
    setPeersLoading(true);
    setPeersError(null);
    getStockPeers(data.symbol, indexName, selectedScore)
      .then((res: PeersResponse) => {
        if (cancelled) return;
        setPeers(res.peers ?? []);
        setPeersSector(res.sector ?? null);
        setPeerSource(res.peer_source ?? null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPeers([]);
        setPeersSector(null);
        setPeerSource(null);
        setPeersError(e instanceof Error ? e.message : "Failed to load peers");
      })
      .finally(() => {
        if (!cancelled) setPeersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, data?.symbol, indexName, selectedScore]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        side="right"
        className="overflow-auto w-[min(96vw,1770px)] max-w-[1800px] sm:max-w-[1800px] px-6 py-7 sm:px-9 sm:py-8 text-base leading-relaxed"
      >
        <DialogHeader className="pb-2 mb-0 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between pr-10 sm:pr-12">
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight">
                {data ? data.symbol : "Stock Details"}
              </DialogTitle>
              <DialogDescription className="text-sm sm:text-base text-muted-foreground">
                {data?.name ?? "Equity analysis"}
              </DialogDescription>
            </div>
            <DrawerLayoutPicker value={drawerLayout} onChange={setDrawerLayoutPersist} />
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-[8rem] items-center justify-center text-base text-muted-foreground">
            Loading…
          </div>
        ) : error ? (
          <div className="flex min-h-[8rem] items-center justify-center text-base font-medium text-destructive">
            {error}
          </div>
        ) : data ? (
          <div className="pr-1 sm:pr-0">

            {/* ── Key metrics row ── */}
            <div className="mt-5 flex flex-wrap items-end gap-8 gap-y-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Last
                </div>
                <div className="text-3xl font-semibold tabular-nums leading-none mt-1">
                  {data.close?.toFixed(2) ?? "—"}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
                  Signal
                </div>
                <TrendBadge signal={data.signals?.[0] ?? "N/A"} />
              </div>

              <div className="ml-auto text-right min-w-[6rem]">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {SCORE_LABELS[selectedScore]}
                </div>
                <div className="text-lg tabular-nums font-semibold leading-tight mt-1">
                  {fmt4(data.scores[selectedScore])}
                </div>
              </div>
            </div>

            <Divider />

            {(() => {
              const hasChart = !!(data.chart_data && data.chart_data.length > 0);

              const fundamentalsBlock = (
                <>
                  <SectionLabel>Quarterly fundamentals (last 3 periods)</SectionLabel>
                  {data.quarterly_financials ? (
                    <QuarterlyFinancialsPanel symbol={data.symbol} data={data.quarterly_financials} />
                  ) : (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Quarterly statements not available (plan limits, symbol, or API error).
                    </p>
                  )}
                  <Divider />
                  <SectionLabel>Peer comparison</SectionLabel>
                  <PeerComparisonTable
                    sector={peersSector}
                    peerSource={peerSource}
                    peers={peers}
                    loading={peersLoading}
                    error={peersError}
                  />
                </>
              );

              const chartHeatSyncProps =
                trendView === "heatmap"
                  ? {
                      syncHoverDate: chartHeatSyncDate,
                      onSyncHoverDate: setChartHeatSyncDate,
                    }
                  : {};

              const chartBlock = hasChart ? (
                <>
                  <SectionLabel>Price Chart</SectionLabel>
                  <PriceChart data={data} {...chartHeatSyncProps} />
                </>
              ) : null;

              const signalFibBlock = (
                <>
                  <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <SectionLabel className="mb-0">
                      Signal History
                      <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                        · {data.date_labels.length} days
                      </span>
                    </SectionLabel>
                    <div className="inline-flex rounded-lg border p-1 bg-muted/40 shrink-0">
                      <button
                        type="button"
                        onClick={() => setTrendView("heatmap")}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                          trendView === "heatmap"
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        Heatmap
                      </button>
                      <button
                        type="button"
                        onClick={() => setTrendView("timeline")}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
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
                    <SignalHeatmap
                      dateLabels={data.date_labels}
                      signals={data.signals}
                      closes={data.closes}
                      chartData={data.chart_data}
                      syncHoverDate={chartHeatSyncDate}
                      onSyncHoverDate={setChartHeatSyncDate}
                    />
                  ) : (
                    <SignalTimeline dateLabels={data.date_labels} signals={data.signals} closes={data.closes} />
                  )}
                  <Divider />
                  <div className="text-sm">
                    <FibPanel data={data} />
                  </div>
                </>
              );

              if (drawerLayout === "stacked") {
                return (
                  <div className="space-y-0">
                    {hasChart ? <div className="min-w-0">{chartBlock}</div> : null}
                    {hasChart ? <Divider /> : null}
                    <div className="min-w-0">{signalFibBlock}</div>
                    <Divider />
                    <div className="min-w-0">{fundamentalsBlock}</div>
                  </div>
                );
              }

              if (drawerLayout === "chart_top") {
                return (
                  <div className="space-y-0">
                    {hasChart ? (
                      <div className="min-w-0 w-full">{chartBlock}</div>
                    ) : null}
                    {hasChart ? <Divider /> : null}
                    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-10 items-start">
                      <div className="min-w-0 lg:pr-1">{fundamentalsBlock}</div>
                      <div className="min-w-0 lg:border-l lg:border-border/60 lg:pl-8">{signalFibBlock}</div>
                    </div>
                  </div>
                );
              }

              /* split (default): fundamentals | chart + signals + fib */
              return (
                <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:gap-10 items-start">
                  <div className="min-w-0 space-y-0 lg:pr-1">{fundamentalsBlock}</div>
                  <div className="min-w-0 space-y-0 lg:border-l lg:border-border/60 lg:pl-8">
                    {hasChart ? (
                      <>
                        {chartBlock}
                        <Divider />
                      </>
                    ) : null}
                    {signalFibBlock}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="flex min-h-[8rem] items-center justify-center text-base text-muted-foreground">
            Click a row to load details.
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
