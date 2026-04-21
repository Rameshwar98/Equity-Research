"use client";

import * as React from "react";

import { FibPanel } from "@/components/fib-panel";
import { PeerComparisonTable } from "@/components/peer-comparison-table";
import { QuarterlyFinancialsPanel } from "@/components/quarterly-financials-panel";
import { PriceChart } from "@/components/price-chart";
import { SignalHeatmap } from "@/components/signal-heatmap";
import { SignalTimeline } from "@/components/signal-timeline";
import { StockNewsPanel } from "@/components/stock-news-panel";
import { TrendBadge } from "@/components/trend-badge";
import { getStockPeers } from "@/lib/api";
import {
  sliceFinancialColumns,
  type FundamentalsView,
} from "@/lib/fundamentals-view";
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

type DrawerMainTab = "overview" | "news";

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
  const [fundamentalsView, setFundamentalsView] = React.useState<FundamentalsView>("q8");
  const [drawerMainTab, setDrawerMainTab] = React.useState<DrawerMainTab>("overview");

  React.useEffect(() => {
    setChartHeatSyncDate(null);
  }, [open, data?.symbol, trendView]);

  React.useEffect(() => {
    setFundamentalsView("q8");
  }, [data?.symbol]);

  React.useEffect(() => {
    setDrawerMainTab("overview");
  }, [open, data?.symbol]);

  const displayedFundamentals = React.useMemo(() => {
    if (!data) return null;
    if (fundamentalsView === "y3") {
      return data.annual_financials ?? null;
    }
    const q = data.quarterly_financials;
    if (!q) return null;
    return fundamentalsView === "q4"
      ? sliceFinancialColumns(q, 4)
      : sliceFinancialColumns(q, 8);
  }, [data, fundamentalsView]);

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
            <div className="min-w-0 space-y-2">
              <DialogTitle className="text-xl sm:text-2xl font-bold tracking-tight">
                {data ? data.symbol : "Stock Details"}
              </DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2 text-left text-sm sm:text-base text-muted-foreground">
                  {!data && "Open a row to load details."}
                  {data && (
                    <>
                      {data.name ? (
                        <div className="font-semibold text-foreground">{data.name}</div>
                      ) : null}
                      {data.description ? (
                        <p className="text-sm font-normal leading-relaxed text-muted-foreground">
                          {data.description}
                        </p>
                      ) : null}
                      {!data.name && !data.description ? (
                        <span>Equity analysis</span>
                      ) : null}
                    </>
                  )}
                </div>
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

            {/* ── Key metrics row (original layout), but aligned heights ── */}
            <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground leading-none">
                  Last
                </div>
                <div className="flex min-h-[3rem] items-end">
                  <div className="text-3xl font-semibold tabular-nums leading-none">
                    {data.close?.toFixed(2) ?? "—"}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground leading-none">
                  Signal
                </div>
                <div className="flex min-h-[3rem] items-end">
                  <TrendBadge
                    signal={data.signals?.[0] ?? "N/A"}
                    className="px-4 py-2 text-sm font-semibold"
                  />
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground leading-none">
                  View
                </div>
                <div className="flex min-h-[3rem] items-end">
                  <div
                    className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-1"
                    role="tablist"
                    aria-label="Drawer content"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={drawerMainTab === "overview"}
                      onClick={() => setDrawerMainTab("overview")}
                      className={cn(
                        "rounded-md px-4 py-2 text-sm font-semibold transition-all",
                        drawerMainTab === "overview"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      Overview
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={drawerMainTab === "news"}
                      onClick={() => setDrawerMainTab("news")}
                      className={cn(
                        "rounded-md px-4 py-2 text-sm font-semibold transition-all",
                        drawerMainTab === "news"
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      News
                    </button>
                  </div>
                </div>
              </div>

              <div className="ml-auto flex min-w-[6rem] flex-col gap-1.5 text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground leading-none">
                  {SCORE_LABELS[selectedScore]}
                </div>
                <div className="flex min-h-[3rem] items-end justify-end">
                  <div className="text-lg tabular-nums font-semibold leading-none">
                    {fmt4(data.scores[selectedScore])}
                  </div>
                </div>
              </div>
            </div>

            <Divider />

            {drawerMainTab === "news" ? (
              <>
                <SectionLabel className="mb-3">News</SectionLabel>
                <StockNewsPanel symbol={data.symbol} />
              </>
            ) : null}

            {drawerMainTab === "overview"
              ? (() => {
              const hasChart = !!(data.chart_data && data.chart_data.length > 0);

              const fundamentalsBlock = (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-2 mb-2.5">
                    <SectionLabel className="mb-0">Fundamentals</SectionLabel>
                    <div
                      className="inline-flex shrink-0 rounded-lg border border-border/80 bg-muted/40 p-1"
                      role="group"
                      aria-label="Fundamentals period"
                    >
                      {(
                        [
                          { id: "q4" as const, label: "4Q" },
                          { id: "q8" as const, label: "8Q" },
                          { id: "y3" as const, label: "3Y" },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setFundamentalsView(opt.id)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                            fundamentalsView === opt.id
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {displayedFundamentals ? (
                    <QuarterlyFinancialsPanel symbol={data.symbol} data={displayedFundamentals} />
                  ) : fundamentalsView === "y3" ? (
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      No annual fundamentals returned. FMP Starter and above typically include annual
                      statements; the Free tier is often quarterly-only. If 4Q/8Q works but 3Y is empty,
                      verify your plan, symbol coverage, and backend logs.
                    </p>
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
                    <SignalTimeline
                      dateLabels={data.date_labels}
                      signals={data.signals}
                      closes={data.closes}
                      scores={data.score_timeline}
                    />
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
            })()
              : null}
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
