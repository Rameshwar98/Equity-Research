"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";

import { PortfolioShell } from "@/components/portfolio-shell";
import { DashboardSignalHeatmap } from "@/components/dashboard-signal-heatmap";
import { StockDrawer } from "@/components/stock-drawer";
import { Week52RangeBar } from "@/components/week-52-range-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HoldingsPnlTable } from "@/components/holdings-pnl-table";
import { cn } from "@/lib/utils";
import { downloadCsv, toCsv } from "@/lib/csv";
import {
  commitPortfolioRebalance,
  discardPortfolioRebalance,
  getPortfolio,
  getPortfolioHoldings,
  getPortfolioPriceHistory,
  replayPortfolioPriceTracking,
  getPortfolioRebalancePreview,
  getPortfolioRebalanceProgress,
  getStockDetails,
  startPortfolioRebalance,
} from "@/lib/api";
import { invalidateAnalyticsPageBundle } from "@/lib/portfolio-analytics-bundle-cache";
import type {
  HoldingsView,
  HoldingsPnlRow,
  MomentumComputedRow,
  MomentumPreview,
  Portfolio,
  StockDetailsResponse,
} from "@/lib/types";

function pct(n: number, d: number) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function fmtPct(v: number) {
  if (Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function fmtPctTable(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtNum(v: number) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

function fmtScore3(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(4);
}

function holdingsLoadHint(error: string | null): string {
  if (!error) {
    return "The request failed before we could read snapshots. Try again in a moment.";
  }
  const lower = error.toLowerCase();
  if (lower.includes("404") || lower.includes("not found")) {
    return (
      "This portfolio is not on the server. That often happens after a Render redeploy when storage was under /tmp, " +
      "or when opening an old bookmark. Go to Portfolios, pick a portfolio from the list, or create a new one. " +
      "For production, attach a Render persistent disk and set DATA_DIR (see README)."
    );
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      return (
        "Check that the API on Render is running and NEXT_PUBLIC_API_BASE_URL points to it. " +
        "Open /api/health on the API host — storage_ephemeral should be false if portfolios are persisted."
      );
    }
  }
  return "If this keeps happening locally, confirm uvicorn is running on port 8000.";
}

function fmtCap(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toFixed(0);
}

function pctColor(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "";
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-rose-600 dark:text-rose-400";
  return "";
}

function BandBadge({ band }: { band: MomentumComputedRow["band"] }) {
  const base = "px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide";
  if (band === "BUY") return <Badge variant="buy" className={base}>BUY</Badge>;
  if (band === "EXIT") return <Badge variant="sell" className={base}>EXIT</Badge>;
  if (band === "WATCH") return <Badge variant="hold" className={base}>WATCH</Badge>;
  // HOLD: use screener-style badge treatment but blue
  return (
    <Badge
      variant="outline"
      className={cn(base, "bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-500/25")}
    >
      HOLD
    </Badge>
  );
}

function rowAccentClass(band: MomentumComputedRow["band"]) {
  switch (band) {
    case "BUY":
      return "border-l-[3px] border-l-emerald-500/70 dark:border-l-emerald-400/70";
    case "HOLD":
      return "border-l-[3px] border-l-blue-500/70 dark:border-l-blue-400/70";
    case "WATCH":
      return "border-l-[3px] border-l-amber-500/70 dark:border-l-amber-400/70";
    case "EXIT":
      return "border-l-[3px] border-l-rose-500/70 dark:border-l-rose-400/70";
    default:
      return "border-l-[3px] border-l-transparent";
  }
}

function RowTable({
  title,
  rows,
  onSymbolClick,
  showRanks,
}: {
  title: string;
  rows: MomentumComputedRow[];
  onSymbolClick: (sym: string) => void;
  showRanks?: boolean;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-base font-semibold tracking-tight text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{rows.length} rows</div>
        </div>
        <div className="overflow-x-auto">
          <table
            className="w-full border-separate border-spacing-0 text-xs font-medium"
          >
            <thead>
              <tr className="text-muted-foreground">
                <th
                  className="sticky top-0 w-[46px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium"
                >
                  #
                </th>
                <th
                  className="sticky top-0 w-[78px] bg-card/95 backdrop-blur py-2 pr-2 text-left font-medium"
                >
                  Symbol
                </th>
                <th className="sticky top-0 w-[180px] bg-card/95 backdrop-blur py-2 pr-2 text-left font-medium">
                  Name
                </th>
                <th className="sticky top-0 w-[84px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">Last</th>
                <th className="sticky top-0 w-[76px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">Mkt Cap</th>
                <th className="sticky top-0 w-[80px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">Score 3</th>
                <th className="sticky top-0 w-[64px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">Score</th>
                <th className="sticky top-0 w-[82px] bg-card/95 backdrop-blur py-2 pr-2 text-left font-medium">Band</th>
                <th className="sticky top-0 w-[80px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">MA50</th>
                <th className="sticky top-0 w-[58px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">Mo</th>
                <th className="sticky top-0 w-[140px] bg-card/95 backdrop-blur py-2 pr-2 text-left font-medium">Sector</th>
                <th className="sticky top-0 w-[62px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">1Y</th>
                <th className="sticky top-0 w-[62px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">1W%</th>
                <th className="sticky top-0 w-[62px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">1M%</th>
                <th className="sticky top-0 w-[62px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">3M%</th>
                <th className="sticky top-0 w-[62px] bg-card/95 backdrop-blur py-2 pr-2 text-right font-medium">YTD%</th>
                <th className="sticky top-0 w-[160px] bg-card/95 backdrop-blur py-2 pr-2 text-center font-medium">52W</th>
                <th className="sticky top-0 w-[120px] bg-card/95 backdrop-blur py-2 text-left font-medium">Heatmap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.symbol}
                  className={`border-t border-border/60 ${rowAccentClass(r.band)}`}
                >
                  <td
                    className="py-2 pr-2 text-right tabular-nums text-muted-foreground"
                  >
                    {idx + 1}
                  </td>
                  <td className="py-2 pr-2 font-semibold tabular-nums">
                    <button className="hover:underline" onClick={() => onSymbolClick(r.symbol)}>
                      {r.symbol}
                    </button>
                  </td>
                  <td className="py-2 pr-2 text-muted-foreground">
                    <div className="max-w-[180px] truncate" title={r.name || ""}>
                      {r.name || "—"}
                    </div>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums font-semibold">
                    {fmtNum(r.last_price)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                    {fmtCap(r.mkt_cap ?? null)}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">{fmtScore3(r.score_3 ?? null)}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.combined_score >= 1e9 ? "∞" : r.combined_score}</td>
                  <td className="py-2 pr-2">
                    <BandBadge band={r.band} />
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums text-muted-foreground">
                    {fmtNum(r.ma50)}
                    <span className="ml-1 text-[10px]">
                      {r.price_vs_50ma === "below" ? "↓" : "↑"}
                      {r.ma_override_active ? "*" : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{r.months_held || 0}</td>
                  <td className="py-2 pr-2 text-muted-foreground">
                    <div className="truncate" title={r.sector || ""}>
                      {r.sector || "—"}
                    </div>
                  </td>
                  <td className={cn("py-2 pr-2 text-right tabular-nums", pctColor((r.return_1y ?? 0) * 100))}>
                    {fmtPct(r.return_1y)}
                  </td>
                  <td className={cn("py-2 pr-2 text-right tabular-nums", pctColor(r.return_1w ?? null))}>
                    {fmtPctTable(r.return_1w ?? null)}
                  </td>
                  <td className={cn("py-2 pr-2 text-right tabular-nums", pctColor(r.return_1m ?? null))}>
                    {fmtPctTable(r.return_1m ?? null)}
                  </td>
                  <td className={cn("py-2 pr-2 text-right tabular-nums", pctColor(r.return_3m ?? null))}>
                    {fmtPctTable(r.return_3m ?? null)}
                  </td>
                  <td className={cn("py-2 pr-2 text-right tabular-nums", pctColor(r.return_ytd ?? null))}>
                    {fmtPctTable(r.return_ytd ?? null)}
                  </td>
                  <td className="py-2 pr-2">
                    <Week52RangeBar low={r.low_52w ?? null} high={r.high_52w ?? null} last={r.last_price} />
                  </td>
                  <td className="py-2">
                    <DashboardSignalHeatmap
                      signals={r.signals_1y}
                      dates={r.signals_1y_dates}
                      variant="compact"
                    />
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={18} className="py-8 text-center text-muted-foreground">
                    No rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ImprovementTable({
  title,
  rows,
  onSymbolClick,
}: {
  title: string;
  rows: {
    symbol: string;
    name?: string | null;
    sector?: string | null;
    rank_delta: number;
    previous_rank: number;
    current_rank: number;
    combined_score: number;
  }[];
  onSymbolClick: (sym: string) => void;
}) {
  const sorted = [...rows].sort((a, b) => {
    const da = a.rank_delta;
    const db = b.rank_delta;
    return db - da || a.current_rank - b.current_rank || a.symbol.localeCompare(b.symbol);
  });

  const Arrow = ({ delta }: { delta: number }) => {
    if (delta > 0) return <span className="text-emerald-700 dark:text-emerald-400">↑</span>;
    if (delta < 0) return <span className="text-rose-700 dark:text-rose-400">↓</span>;
    return <span className="text-muted-foreground">→</span>;
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="text-xs text-muted-foreground">{rows.length} rows</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr className="text-muted-foreground">
                <th className="sticky top-0 bg-card/95 backdrop-blur text-left py-2 pr-3">Symbol</th>
                <th className="sticky top-0 bg-card/95 backdrop-blur text-left py-2 pr-3">Name</th>
                <th className="sticky top-0 bg-card/95 backdrop-blur text-left py-2 pr-3">Sector</th>
                <th className="sticky top-0 bg-card/95 backdrop-blur text-right py-2 pr-3">Δ rank</th>
                <th className="sticky top-0 bg-card/95 backdrop-blur text-right py-2 pr-3">Prev</th>
                <th className="sticky top-0 bg-card/95 backdrop-blur text-right py-2 pr-3">Now</th>
                <th className="sticky top-0 bg-card/95 backdrop-blur text-right py-2">Score</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.symbol} className="border-t border-border/60">
                  <td className="py-2 pr-3 font-medium">
                    <button className="hover:underline" onClick={() => onSymbolClick(r.symbol)}>
                      {r.symbol}
                    </button>
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.name || "—"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{r.sector || "—"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <Arrow delta={r.rank_delta} />
                      <span
                        className={
                          r.rank_delta > 0
                            ? "text-emerald-700 dark:text-emerald-400"
                            : r.rank_delta < 0
                              ? "text-rose-700 dark:text-rose-400"
                              : "text-muted-foreground"
                        }
                      >
                        {r.rank_delta > 0 ? `+${r.rank_delta}` : r.rank_delta}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.previous_rank}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.current_rank}</td>
                  <td className="py-2 text-right tabular-nums">{r.combined_score}</td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted-foreground">
                    No rows.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

export default function PortfolioHoldingsPage() {
  const params = useParams<{ id: string | string[] | undefined }>();
  const searchParams = useSearchParams();
  const rawId = params?.id;
  const portfolioId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [portfolio, setPortfolio] = React.useState<Portfolio | null>(null);
  const [view, setView] = React.useState<HoldingsView | null>(null);
  const [pnlRows, setPnlRows] = React.useState<HoldingsPnlRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [runId, setRunId] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<{
    status: "running" | "done" | "error";
    processed: number;
    total: number;
    progressPercent: number | null;
    etaSeconds: number | null;
    message: string | null;
    error: string | null;
  } | null>(null);

  const [preview, setPreview] = React.useState<MomentumPreview | null>(null);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [commitBusy, setCommitBusy] = React.useState(false);

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<StockDetailsResponse | null>(null);

  const [activeTab, setActiveTab] = React.useState<
    "current" | "incoming" | "exit" | "on_deck" | "pnl" | "doi"
  >("current");
  const [resyncBusy, setResyncBusy] = React.useState(false);

  const refresh = React.useCallback(async (isCancelled: () => boolean) => {
    if (!portfolioId) {
      setError("Missing portfolio id.");
      setLoading(false);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Load large /holdings after other calls (same pattern as Analytics) to avoid
      // parallel burst + Strict Mode double-mount connection issues → "Failed to fetch".
      const [p, ph] = await Promise.all([
        getPortfolio(portfolioId),
        getPortfolioPriceHistory(portfolioId),
      ]);
      if (isCancelled()) return;
      setPortfolio(p);
      setPnlRows(ph?.holdings_pnl || []);
      const hv = await getPortfolioHoldings(portfolioId);
      if (isCancelled()) return;
      setView(hv);
    } catch (e: unknown) {
      if (!isCancelled()) {
        setView(null);
        setPnlRows([]);
        setError(e instanceof Error ? e.message : "Failed to load holdings");
      }
    } finally {
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, [portfolioId]);

  async function onResyncPnlTracking() {
    if (!portfolioId) return;
    setResyncBusy(true);
    setError(null);
    try {
      await replayPortfolioPriceTracking(portfolioId);
      await refresh(() => false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Resync failed");
    } finally {
      setResyncBusy(false);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    void refresh(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  async function onRun() {
    if (!portfolioId) return;
    setPreview(null);
    setPreviewOpen(false);
    setProgress({
      status: "running",
      processed: 0,
      total: 0,
      progressPercent: null,
      etaSeconds: null,
      message: "Starting…",
      error: null,
    });
    try {
      const started = await startPortfolioRebalance(portfolioId);
      setRunId(started.run_id);
    } catch (e: unknown) {
      setProgress({
        status: "error",
        processed: 0,
        total: 0,
        progressPercent: null,
        etaSeconds: null,
        message: "Error",
        error: e instanceof Error ? e.message : "Failed to start rebalance",
      });
    }
  }

  React.useEffect(() => {
    const shouldAutoRun = searchParams.get("run") === "1";
    if (!shouldAutoRun) return;
    // Only auto-run on first render when explicitly asked.
    onRun();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!runId || !portfolioId) return;
    const rid: string = runId;
    const pid = portfolioId;
    let cancelled = false;
    async function loop() {
      while (!cancelled) {
        try {
          const p = await getPortfolioRebalanceProgress(pid, rid);
          if (cancelled) return;
          setProgress({
            status: p.status,
            processed: p.processed,
            total: p.total,
            progressPercent: p.progress_percent,
            etaSeconds: p.eta_seconds,
            message: p.message,
            error: p.error,
          });
          if (p.status === "done") {
            const pv = await getPortfolioRebalancePreview(pid, rid);
            if (cancelled) return;
            setPreview(pv);
            setPreviewOpen(true);
            return;
          }
          if (p.status === "error") return;
        } catch (e: unknown) {
          if (cancelled) return;
          setProgress((cur) =>
            cur
              ? { ...cur, status: "error", message: "Error", error: e instanceof Error ? e.message : "Failed to poll" }
              : null
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
    loop();
    return () => {
      cancelled = true;
    };
  }, [portfolioId, runId]);

  async function onCommit() {
    if (!runId || !portfolioId || commitBusy) return;
    setCommitBusy(true);
    try {
      await commitPortfolioRebalance(portfolioId, runId);
      invalidateAnalyticsPageBundle(portfolioId);
      setPreviewOpen(false);
      setPreview(null);
      setRunId(null);
      await refresh(() => false);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Commit failed");
    } finally {
      setCommitBusy(false);
    }
  }

  async function onDiscard() {
    if (!runId || !portfolioId) return;
    try {
      await discardPortfolioRebalance(portfolioId, runId);
      setPreviewOpen(false);
      setPreview(null);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Discard failed");
    }
  }

  async function onSymbolClick(sym: string) {
    setDrawerOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetails(null);
    try {
      const d = await getStockDetails(sym);
      setDetails(d);
    } catch (e: unknown) {
      setDetailsError(e instanceof Error ? e.message : "Failed to load stock details");
    } finally {
      setDetailsLoading(false);
    }
  }

  const holdings = React.useMemo(() => view?.last_snapshot?.holdings || [], [view]);
  const top100 = React.useMemo(() => view?.last_snapshot?.top100_rows || [], [view]);
  const heldSymbols = React.useMemo(() => new Set(holdings.map((h) => h.symbol)), [holdings]);

  // No search/filter controls: keep tables "first glance" with full lists.
  const filteredHoldings = holdings;
  const filteredIncoming = view?.last_snapshot?.incoming || [];
  const filteredOutgoing = view?.last_snapshot?.outgoing || [];
  const filteredOnDeck = view?.last_snapshot?.on_deck || [];

  const canExportCsv = filteredHoldings.length > 0;
  const onExportCsv = React.useCallback(() => {
    if (!canExportCsv || !portfolioId) return;
    const rows = filteredHoldings.map((r) => ({
      symbol: r.symbol,
      name: r.name || "",
      sector: r.sector || "",
      price_date: r.price_date,
      last_price: r.last_price,
      return_1y: r.return_1y,
      annualized_sd: r.annualized_sd,
      combined_rank: r.combined_rank,
      score_3: r.score_3 ?? "",
      band: r.band,
      action: r.action,
      months_held: r.months_held || 0,
    }));
    downloadCsv(`holdings-${portfolioId}.csv`, toCsv(rows));
  }, [canExportCsv, filteredHoldings, portfolioId]);

  return (
    <PortfolioShell
      lastRebalanceAt={view?.last_snapshot?.created_at || null}
      actions={
        <>
          <Button className="h-8 px-3 text-xs" onClick={onRun} disabled={progress?.status === "running"}>
            {progress?.status === "running" ? "Running…" : "Run Rebalance Now"}
          </Button>
          <Button className="h-8 px-3 text-xs" variant="outline" onClick={onExportCsv} disabled={!canExportCsv}>
            Export CSV
          </Button>
          <Button
            className="h-8 px-3 text-xs"
            variant="outline"
            onClick={() => void refresh(() => false)}
            disabled={loading || !portfolioId}
          >
            Refresh
          </Button>
        </>
      }
      status={
        progress?.status === "running" ? (
          <span className="font-medium text-foreground">
            {progress.message || "Running"}
            {progress.total ? ` (${progress.processed}/${progress.total})` : ""}
            {progress.progressPercent != null ? ` · ${progress.progressPercent.toFixed(1)}%` : ""}
            {progress.etaSeconds != null ? ` · ~${Math.round(progress.etaSeconds)}s` : ""}
          </span>
        ) : progress?.status === "error" && progress.error ? (
          <span className="font-medium text-destructive">{progress.error}</span>
        ) : null
      }
    >
      {loading ? (
        <div className="rounded-xl border bg-card p-10 text-center text-base text-muted-foreground">Loading…</div>
      ) : error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-10 text-center text-base text-muted-foreground leading-relaxed max-w-xl mx-auto">
          <div className="text-lg font-semibold text-foreground">Couldn’t load holdings</div>
          <div className="mt-2 text-xs text-destructive break-words">{error}</div>
          <div className="mt-2 text-sm">
            {holdingsLoadHint(error)}
          </div>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => void refresh(() => false)}>Retry</Button>
            <Button variant="outline" onClick={onRun}>
              Run Rebalance Now
            </Button>
          </div>
        </div>
      ) : !view?.last_snapshot ? (
        <div className="rounded-xl border bg-card p-10 text-center text-base text-muted-foreground leading-relaxed max-w-xl mx-auto">
          <div className="text-lg font-semibold text-foreground">Run your first rebalance</div>
          <div className="mt-2">This portfolio doesn’t have any committed snapshot yet.</div>
          <div className="mt-5">
            <Button onClick={onRun}>Run Rebalance Now</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tabbed tables (avoid long scrolling) */}
          <Card className="shadow-sm">
            <CardContent className="p-3">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: "current", label: `Current (${filteredHoldings.length})` },
                    { id: "incoming", label: `Incoming (${filteredIncoming.length})` },
                    { id: "exit", label: `Exit (${filteredOutgoing.length})` },
                    { id: "on_deck", label: `On Deck (${filteredOnDeck.length})` },
                    { id: "pnl", label: `Holdings P&L (${pnlRows.length})` },
                    {
                      id: "doi",
                      label: `Degree of Improvement (${(view.last_snapshot.degree_of_improvement_watchlist || []).length})`,
                    },
                  ] as const
                ).map((t) => {
                  const isActive = activeTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTab(t.id)}
                      className={cn(
                        "rounded-md border px-3 py-1.5 text-xs font-medium",
                        isActive
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40"
                      )}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {!view.previous_snapshot ? (
                <div className="mt-2 text-xs text-muted-foreground">
                  Incoming/Exit tables populate from the second rebalance onward (once a previous snapshot exists).
                </div>
              ) : null}
            </CardContent>
          </Card>

          {activeTab === "current" ? (
            <RowTable
              title="Current Holdings"
              rows={filteredHoldings}
              onSymbolClick={onSymbolClick}
            />
          ) : null}

          {activeTab === "incoming" ? (
            <RowTable
              title="Incoming (BUY candidates)"
              rows={filteredIncoming}
              onSymbolClick={onSymbolClick}
            />
          ) : null}

          {activeTab === "exit" ? (
            <RowTable
              title="Outgoing (EXIT queue)"
              rows={filteredOutgoing}
              onSymbolClick={onSymbolClick}
            />
          ) : null}

          {activeTab === "on_deck" ? (
            <RowTable
              title="On Deck (Ranks 26–50)"
              rows={filteredOnDeck}
              onSymbolClick={onSymbolClick}
            />
          ) : null}

          {activeTab === "pnl" ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground max-w-xl">
                  Entry dates come from price tracking. If they look wrong after a backend upgrade, resync
                  replays all committed snapshots into the tracking DB (no snapshot deletion).
                </p>
                <Button type="button" variant="outline" size="sm" disabled={resyncBusy} onClick={onResyncPnlTracking}>
                  {resyncBusy ? "Resyncing…" : "Resync P&L from snapshots"}
                </Button>
              </div>
              <HoldingsPnlTable rows={pnlRows} />
            </div>
          ) : null}

          {activeTab === "doi" ? (
            <ImprovementTable
              title="Degree of Improvement watchlist"
              rows={view.last_snapshot.degree_of_improvement_watchlist || []}
              onSymbolClick={onSymbolClick}
            />
          ) : null}
        </div>
      )}

      {/* Preview dialog */}
      {previewOpen && preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-4xl rounded-xl border bg-card shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-foreground">Rebalance preview</div>
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={onDiscard}>
                Close
              </button>
            </div>
            <div className="p-4 space-y-4 max-h-[75vh] overflow-auto">
              <div className="text-xs text-muted-foreground">
                Buys: <span className="font-medium text-foreground">{preview.incoming.length}</span> · Exits:{" "}
                <span className="font-medium text-foreground">{preview.outgoing.length}</span> · Holds:{" "}
                <span className="font-medium text-foreground">{preview.hold.length}</span> · Watch:{" "}
                <span className="font-medium text-foreground">{preview.watch.length}</span>
                {preview.skipped_symbols.length ? (
                  <span className="ml-2 text-amber-700 dark:text-amber-300">
                    Skipped {preview.skipped_symbols.length} symbols
                  </span>
                ) : null}
              </div>
              {preview.skipped_symbols.length ? (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <div className="font-semibold">Warning: partial data fetch</div>
                  <div className="mt-1 text-[12px] text-amber-800/80 dark:text-amber-200/80">
                    These symbols were skipped due to missing price data:
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {preview.skipped_symbols.slice(0, 80).map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-amber-500/30 bg-background px-2 py-0.5 text-[11px]"
                      >
                        {s}
                      </span>
                    ))}
                    {preview.skipped_symbols.length > 80 ? (
                      <span className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                        +{preview.skipped_symbols.length - 80} more
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <RowTable title="Buy" rows={preview.incoming} onSymbolClick={onSymbolClick} />
              <RowTable title="Exit" rows={preview.outgoing} onSymbolClick={onSymbolClick} />
              <RowTable title="Hold" rows={preview.hold} onSymbolClick={onSymbolClick} />
              <RowTable title="Watch" rows={preview.watch} onSymbolClick={onSymbolClick} />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <Button variant="outline" onClick={onDiscard} disabled={commitBusy}>
                Discard
              </Button>
              <Button onClick={onCommit} disabled={commitBusy}>
                {commitBusy ? "Committing…" : "Commit"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <StockDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        loading={detailsLoading}
        error={detailsError}
        data={details}
        selectedScore={"score_3"}
        indexName={portfolio?.params.universe || "sp500"}
      />
    </PortfolioShell>
  );
}

