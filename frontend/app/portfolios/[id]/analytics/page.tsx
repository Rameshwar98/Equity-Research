"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import {
  RollingSharpeChart,
  TwoLineDrawdownChart,
  TwoLineIndexedChart,
} from "@/components/analytics-charts";
import { SectorDonut } from "@/components/holdings-charts";
import { PortfolioShell } from "@/components/portfolio-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  getPortfolio,
  getPortfolioAnalytics,
  getPortfolioPriceHistory,
  updatePortfolioPrefs,
} from "@/lib/api";
import {
  getAnalyticsPageBundle,
  invalidateAnalyticsPageBundle,
  patchAnalyticsPageBundlePortfolio,
  setAnalyticsPageBundle,
} from "@/lib/portfolio-analytics-bundle-cache";
import { downloadCsv, toCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import type {
  Portfolio,
  PortfolioAnalyticsResponse,
  PortfolioPriceHistoryResponse,
} from "@/lib/types";

const DEFAULT_CAPITAL = 100000;

function fmtP(v?: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}
function fmtPSigned(v?: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(digits)}%`;
}
function fmtNSigned(v?: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}`;
}
function fmtN(v?: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}
function fmtMoney(v?: number | null) {
  if (v == null || !Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(Math.round(v)).toLocaleString()}`;
}
function signClass(v?: number | null) {
  if (v == null || !Number.isFinite(v) || v === 0) return "text-foreground";
  return v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

type Metric = { label: string; value: string; desc?: string; valueClass?: string };

/**
 * One row of the Portfolio | Benchmark | Diff metric tables.
 * - Normal rows: diff = portfolio − benchmark, colored by `diffGood` direction.
 * - `relativeOnly` rows (Beta, TE, R², IR, alpha): the metric already measures the
 *   portfolio AGAINST the benchmark, so it has no separate benchmark value. The number
 *   belongs in the Portfolio column; Benchmark/Diff read "n/a" (rendering it under Diff
 *   made a beta of 0.95 look like a difference, and the row look empty).
 */
type TriMetric = {
  label: string;
  desc?: string;
  port?: number | null;
  bench?: number | null;
  fmt: (v?: number | null) => string;
  fmtDiff?: (v?: number | null) => string;
  diffGood?: "up" | "down" | "none";
  relativeOnly?: boolean;
  relClass?: string;
};

function diffClass(diff: number | null, good: "up" | "down" | "none") {
  if (diff == null || !Number.isFinite(diff) || diff === 0 || good === "none") return "text-foreground";
  const positive = good === "up" ? diff > 0 : diff < 0;
  return positive ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function MetricTable({
  title,
  accent,
  benchmarkLabel,
  rows,
}: {
  title: string;
  accent?: string;
  benchmarkLabel?: string | null;
  rows: TriMetric[];
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-1.5 text-sm font-semibold" style={accent ? { color: accent } : undefined}>
          {title}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10.5px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 text-center font-semibold">Metric</th>
              <th className="py-1 text-center font-semibold">Portfolio</th>
              <th className="py-1 text-center font-semibold" title={benchmarkLabel || undefined}>
                Benchmark
              </th>
              <th className="py-1 text-center font-semibold">Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const diff =
                m.port != null && m.bench != null && Number.isFinite(m.port) && Number.isFinite(m.bench)
                  ? m.port - m.bench
                  : null;
              const fmtDiff = m.fmtDiff || m.fmt;
              return (
                <tr key={m.label} className="border-t border-border/40">
                  <td className="py-1.5 pr-2">
                    <div className="text-[13px] text-foreground">{m.label}</div>
                    {m.desc ? <div className="text-[10.5px] text-muted-foreground">{m.desc}</div> : null}
                  </td>
                  {m.relativeOnly ? (
                    <>
                      <td
                        className={cn(
                          "py-1.5 text-right font-semibold tabular-nums",
                          m.relClass || "text-foreground"
                        )}
                      >
                        {m.fmt(m.port)}
                        <span
                          className="ml-1 cursor-help text-[9px] font-normal text-muted-foreground"
                          title={`Already measured against ${benchmarkLabel || "the benchmark"}, so there is no separate benchmark value.`}
                        >
                          rel.
                        </span>
                      </td>
                      <td className="py-1.5 text-right text-[11px] text-muted-foreground/60">n/a</td>
                      <td className="py-1.5 text-right text-[11px] text-muted-foreground/60">n/a</td>
                    </>
                  ) : (
                    <>
                      <td className="py-1.5 text-right font-semibold tabular-nums text-foreground">
                        {m.fmt(m.port)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">{m.fmt(m.bench)}</td>
                      <td
                        className={cn(
                          "py-1.5 text-right font-semibold tabular-nums",
                          diffClass(diff, m.diffGood ?? "up")
                        )}
                      >
                        {fmtDiff(diff)}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.some((m) => m.relativeOnly) ? (
          <div className="mt-2 border-t border-border/40 pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium">rel.</span> = relative measure. These already compare the
            portfolio to {benchmarkLabel || "the benchmark"}, so a separate benchmark value and a
            difference are not defined (n/a).
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MetricCard({ title, accent, metrics }: { title: string; accent?: string; metrics: Metric[] }) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-1.5 text-sm font-semibold" style={accent ? { color: accent } : undefined}>
          {title}
        </div>
        <div>
          {metrics.map((m) => (
            <div
              key={m.label}
              className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 last:border-0"
            >
              <div className="min-w-0">
                <div className="text-[13px] text-foreground">{m.label}</div>
                {m.desc ? <div className="text-[10.5px] text-muted-foreground">{m.desc}</div> : null}
              </div>
              <div className={cn("shrink-0 text-sm font-semibold tabular-nums", m.valueClass || "text-foreground")}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PortfolioAnalyticsPage() {
  const params = useParams<{ id: string | string[] | undefined }>();
  const rawId = params?.id;
  const portfolioId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [portfolio, setPortfolio] = React.useState<Portfolio | null>(null);
  const [analytics, setAnalytics] = React.useState<PortfolioAnalyticsResponse | null>(null);
  const [priceHistory, setPriceHistory] = React.useState<PortfolioPriceHistoryResponse | null>(null);
  const [err, setErr] = React.useState<string>("");
  const [loading, setLoading] = React.useState<boolean>(true);
  const [saving, setSaving] = React.useState<boolean>(false);

  const chartPrefs = portfolio?.chart_prefs || {};
  const setChartPref = React.useCallback(
    async (key: string, value: boolean) => {
      if (!portfolio) return;
      setSaving(true);
      setErr("");
      try {
        const next = { ...(portfolio.chart_prefs || {}), [key]: value };
        const updated = await updatePortfolioPrefs(portfolio.id, next);
        setPortfolio(updated);
        patchAnalyticsPageBundlePortfolio(portfolio.id, updated);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setSaving(false);
      }
    },
    [portfolio]
  );

  const loadData = React.useCallback(async (isCancelled: () => boolean) => {
    if (!portfolioId) {
      setErr("Missing portfolio id.");
      setLoading(false);
      return;
    }
    const cached = getAnalyticsPageBundle(portfolioId);
    if (cached && !isCancelled()) {
      setPortfolio(cached.portfolio);
      setAnalytics(cached.analytics);
      setPriceHistory(cached.priceHistory);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setErr("");
    try {
      // Analytics response already includes holdings/top-100/on-deck rows — skip /holdings (large JSON).
      const [p, a, ph] = await Promise.all([
        getPortfolio(portfolioId),
        getPortfolioAnalytics(portfolioId),
        getPortfolioPriceHistory(portfolioId),
      ]);
      if (isCancelled()) return;
      setPortfolio(p);
      setAnalytics(a);
      setPriceHistory(ph);
      setAnalyticsPageBundle(portfolioId, {
        portfolio: p,
        analytics: a,
        priceHistory: ph,
      });
    } catch (e) {
      if (!isCancelled()) {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!isCancelled()) {
        setLoading(false);
      }
    }
  }, [portfolioId]);

  React.useEffect(() => {
    let cancelled = false;
    void loadData(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadData]);

  const a = analytics;
  const k = a?.kpis;
  const charts = a?.charts;
  const benchmarkLabel = a?.benchmark_symbol || portfolio?.params.benchmark || null;
  const holdings = charts?.scatter_holdings || [];
  const heldSymbols = React.useMemo(() => new Set(holdings.map((h) => h.symbol)), [holdings]);
  const dailySeries = React.useMemo(() => {
    const pts = priceHistory?.daily_series || [];
    return pts.map((p) => ({
      date: p.date,
      portfolio: p.portfolio_value ?? null,
      benchmark: p.benchmark_value ?? null,
    }));
  }, [priceHistory]);

  // Cumulative return since inception (%), each line rebased to its own first finite value so
  // both start at 0%. Keeps dailySeries (raw values) intact for the drawdown calc below.
  const cumulativeSeries = React.useMemo(() => {
    const firstFinite = (key: "portfolio" | "benchmark") => {
      for (const d of dailySeries) {
        const v = d[key];
        if (typeof v === "number" && Number.isFinite(v) && v !== 0) return v;
      }
      return null;
    };
    const baseP = firstFinite("portfolio");
    const baseB = firstFinite("benchmark");
    return dailySeries.map((d) => ({
      date: d.date,
      portfolio:
        baseP != null && typeof d.portfolio === "number" && Number.isFinite(d.portfolio)
          ? d.portfolio / baseP - 1
          : null,
      benchmark:
        baseB != null && typeof d.benchmark === "number" && Number.isFinite(d.benchmark)
          ? d.benchmark / baseB - 1
          : null,
    }));
  }, [dailySeries]);

  const drawdownSeries = React.useMemo(() => {
    const pts = dailySeries.filter((d) => typeof d.portfolio === "number" && Number.isFinite(d.portfolio));
    if (!pts.length) return [];
    // rolling max drawdown: (current - rolling_max) / rolling_max, always <= 0 when values are >= 0
    let peak = Math.max(0, pts[0]!.portfolio as number);
    return pts.map((d) => {
      const v = d.portfolio as number;
      if (Number.isFinite(v) && v > peak) peak = v;
      const ddRaw = peak > 0 ? (v - peak) / peak : 0;
      const dd = Number.isFinite(ddRaw) ? Math.min(0, ddRaw) : 0;
      return { ...d, portfolio: dd, benchmark: null };
    });
  }, [dailySeries]);

  // Fund size: per-portfolio capital (set at creation / Settings), default $100k.
  const capital = portfolio?.params.capital && portfolio.params.capital > 0
    ? portfolio.params.capital
    : DEFAULT_CAPITAL;

  // Position P&L on a notional, equal-weight capital basis (the strategy targets equal
  // weights; it has no real cash), derived from per-holding entry/current prices.
  // Restricted to OPEN legs of current holdings — the ledger carries one row per
  // entry→exit leg, so a re-entered symbol also has closed legs that must not count.
  const positionPnl = React.useMemo(() => {
    const rows = (priceHistory?.holdings_pnl || []).filter(
      (r) =>
        typeof r.entry_price === "number" &&
        r.entry_price > 0 &&
        (r.status ?? "open") === "open" &&
        heldSymbols.has(r.symbol)
    );
    const n = rows.length;
    if (!n) return null;
    const costEach = capital / n;
    const mvs = rows.map((r) => {
      const cur = typeof r.current_price === "number" && r.current_price > 0 ? r.current_price : r.entry_price;
      const shares = costEach / r.entry_price;
      return shares * cur;
    });
    const totalMV = mvs.reduce((a, b) => a + b, 0);
    const totalCost = capital;
    const gl = totalMV - totalCost;
    const largest = totalMV > 0 ? Math.max(...mvs) / totalMV : 0;
    const hhi = totalMV > 0 ? mvs.reduce((a, mv) => a + (mv / totalMV) ** 2, 0) : 0;
    return { totalMV, totalCost, gl, retPct: gl / totalCost, n, largest, hhi };
  }, [priceHistory, heldSymbols, capital]);

  const show = React.useCallback(
    (key: string, defaultValue: boolean = true) => {
      const v = chartPrefs[key];
      return typeof v === "boolean" ? v : defaultValue;
    },
    [chartPrefs]
  );

  const hiddenChips = React.useMemo(() => {
    const chips: { key: string; label: string }[] = [
      { key: "analytics_cumulative", label: "Cumulative" },
      { key: "analytics_drawdown", label: "Drawdown" },
      { key: "analytics_rolling_sharpe", label: "Rolling Sharpe" },
      { key: "analytics_sector_donut", label: "Sector exposure" },
    ];
    return chips.filter((c) => !show(c.key, true));
  }, [show]);

  return (
    <PortfolioShell>
      <div className="space-y-4">
        {err ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {err}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Benchmark {a?.benchmark_symbol || "—"}</Badge>
          <Badge variant="secondary">Snapshots {a?.snapshots ?? "—"}</Badge>
          {saving ? <Badge variant="secondary">Saving…</Badge> : null}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const rows =
                  (charts?.scatter_holdings || []).map((r) => ({
                    symbol: r.symbol,
                    name: r.name || "",
                    sector: r.sector || "",
                    price_date: r.price_date,
                    last_price: r.last_price,
                    return_1y: r.return_1y,
                    annualized_sd: r.annualized_sd,
                    combined_rank: r.combined_rank,
                    band: r.band,
                    action: r.action,
                  })) || [];
                downloadCsv(`analytics-holdings-${portfolioId}.csv`, toCsv(rows));
              }}
              disabled={!charts?.scatter_holdings?.length}
            >
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (portfolioId) invalidateAnalyticsPageBundle(portfolioId);
                setAnalytics(null);
                setPortfolio(null);
                setPriceHistory(null);
                void loadData(() => false);
              }}
              disabled={loading || !portfolioId}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Client "Dashboard" metric set (monthly periods) */}
        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
              <span className="text-sm font-semibold text-foreground">Performance metrics</span>
              <span className="rounded-full border border-border px-2 py-0.5">Monthly periods</span>
              <span className="rounded-full border border-border px-2 py-0.5">{k?.periods ?? 0} months</span>
              <span className="rounded-full border border-border px-2 py-0.5">RF {fmtP(k?.rf_annual, 1)}</span>
              <span className="rounded-full border border-border px-2 py-0.5">MAR {fmtP(k?.mar_annual, 0)}</span>
              {benchmarkLabel ? (
                <span className="rounded-full border border-border px-2 py-0.5">Benchmark {benchmarkLabel}</span>
              ) : null}
              {k?.period_start && k?.period_end ? (
                <span
                  className="rounded-full border border-border px-2 py-0.5"
                  title="Metrics cover snapshot-to-snapshot returns over this window; the cumulative chart is daily and runs to the latest close."
                >
                  {k.period_start} → {k.period_end}
                  {k.years_elapsed ? ` (${k.years_elapsed.toFixed(2)} yr)` : ""}
                </span>
              ) : null}
              {k?.min_price_coverage != null && k.min_price_coverage < 0.999 ? (
                <span
                  className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-amber-700 dark:text-amber-300"
                  title="Some holdings had no cached price history and were excluded from a period's equal-weight average."
                >
                  Price coverage {fmtP(k.min_price_coverage, 0)} worst period
                </span>
              ) : null}
            </div>
          </CardContent>
        </Card>

        {(() => {
          const bm = k?.benchmark_metrics || {};
          return (
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              <MetricTable
                title="Return"
                accent="#5b8cff"
                benchmarkLabel={benchmarkLabel}
                rows={[
                  { label: "Cumulative Return", desc: "Total growth, all periods", port: k?.cumulative_return, bench: bm.cumulative_return, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Annualized (CAGR)", desc: "Geometric, annualized", port: k?.cagr, bench: bm.cagr, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Avg Periodic Return", desc: "Mean monthly return", port: k?.avg_periodic_return, bench: bm.avg_periodic_return, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Best Period", desc: "Best month", port: k?.best_period, bench: bm.best_period, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Worst Period", desc: "Worst month", port: k?.worst_period, bench: bm.worst_period, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Win Rate", desc: "% positive months", port: k?.win_rate, bench: bm.win_rate, fmt: fmtP, fmtDiff: fmtPSigned },
                ]}
              />
              <MetricTable
                title="Risk"
                accent="#e0a92e"
                benchmarkLabel={benchmarkLabel}
                rows={[
                  { label: "Volatility (ann.)", desc: "Std dev of returns", port: k?.volatility_annualized, bench: bm.volatility_annualized, fmt: fmtP, fmtDiff: fmtPSigned, diffGood: "down" },
                  { label: "Downside Deviation", desc: "Below target (MAR 0%)", port: k?.downside_deviation, bench: bm.downside_deviation, fmt: fmtP, fmtDiff: fmtPSigned, diffGood: "down" },
                  { label: "Maximum Drawdown", desc: "Worst peak-to-trough", port: k?.max_drawdown, bench: bm.max_drawdown, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Value at Risk (95%)", desc: "5th-pctile month", port: k?.var_95, bench: bm.var_95, fmt: fmtP, fmtDiff: fmtPSigned },
                  { label: "Beta", desc: benchmarkLabel ? `vs ${benchmarkLabel}` : "vs benchmark", port: k?.beta, fmt: fmtN, relativeOnly: true },
                  { label: "Tracking Error", desc: "Std dev of excess", port: k?.tracking_error, fmt: fmtP, relativeOnly: true },
                  { label: "R-squared", desc: "Fit vs benchmark", port: k?.r_squared, fmt: fmtN, relativeOnly: true },
                ]}
              />
              <MetricTable
                title="Risk-adjusted"
                accent="#a78bfa"
                benchmarkLabel={benchmarkLabel}
                rows={[
                  { label: "Sharpe", desc: k?.sharpe_rf_assumption || "vs RF", port: k?.sharpe, bench: bm.sharpe, fmt: fmtN, fmtDiff: fmtNSigned },
                  { label: "Sortino", desc: "Per downside risk", port: k?.sortino, bench: bm.sortino, fmt: fmtN, fmtDiff: fmtNSigned },
                  { label: "Treynor", desc: "Per unit beta", port: k?.treynor, bench: bm.treynor, fmt: fmtN, fmtDiff: fmtNSigned },
                  { label: "Calmar", desc: "CAGR / max drawdown", port: k?.calmar, bench: bm.calmar, fmt: fmtN, fmtDiff: fmtNSigned },
                  { label: "Information Ratio", desc: "Active return / TE", port: k?.information_ratio, fmt: fmtN, relativeOnly: true },
                  { label: "Jensen's Alpha", desc: "Above CAPM (ann.)", port: k?.jensens_alpha, fmt: fmtP, relativeOnly: true, relClass: signClass(k?.jensens_alpha) },
                ]}
              />
            </div>
          );
        })()}

        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard
            title="Position P&L"
            accent="#2fbf71"
            metrics={
              positionPnl
                ? [
                    { label: "Total Market Value", value: fmtMoney(positionPnl.totalMV), desc: `Notional ${fmtMoney(capital)} equal-weight` },
                    { label: "Total Cost Basis", value: fmtMoney(positionPnl.totalCost), desc: "Fund size (Settings → Capital)" },
                    { label: "Unrealized Gain/Loss", value: fmtMoney(positionPnl.gl), valueClass: signClass(positionPnl.gl) },
                    { label: "Unrealized Return %", value: fmtP(positionPnl.retPct), valueClass: signClass(positionPnl.retPct) },
                    { label: "Number of Holdings", value: String(positionPnl.n) },
                    { label: "Largest Position", value: fmtP(positionPnl.largest), desc: "Concentration check" },
                    { label: "Concentration (HHI)", value: fmtN(positionPnl.hhi, 4), desc: "Lower = diversified" },
                  ]
                : [{ label: "Position P&L", value: "—", desc: "Needs daily price tracking" }]
            }
          />
          <MetricCard
            title="Holdings snapshot"
            metrics={[
              { label: "Quality Score", value: k?.quality_score == null ? "—" : fmtP(k?.quality_score, 0), desc: "% holdings beating top-100 medians (return ↑, vol ↓)" },
              { label: "Avg 12M Return (holdings)", value: fmtP(k?.avg_1y_return, 1), desc: "Cross-sectional" },
              { label: "Avg Annualized SD (holdings)", value: fmtP(k?.avg_annualized_sd, 1) },
            ]}
          />
        </div>

        {hiddenChips.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs text-muted-foreground">Hidden:</div>
            {hiddenChips.map((c) => (
              <button
                key={c.key}
                className="rounded-full border border-border bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setChartPref(c.key, true)}
              >
                Show {c.label}
              </button>
            ))}
          </div>
        ) : null}

        {/* Charts */}
        {!a || loading ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading analytics…
          </div>
        ) : (priceHistory?.daily_series?.length || 0) < 2 ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground leading-relaxed">
            Not enough daily history yet. Commit a snapshot to start tracking daily closes.
          </div>
        ) : (
          <div className="space-y-3">
            {show("analytics_sector_donut", true) ? (
              <SectorDonut
                holdings={holdings}
                benchmarkSectors={charts?.benchmark_sectors}
                benchmarkSectorLabel={charts?.benchmark_sector_label}
                benchmarkSectorBasis={charts?.benchmark_sector_basis}
                benchmarkLabel={benchmarkLabel}
                onHide={() => setChartPref("analytics_sector_donut", false)}
              />
            ) : null}

            {show("analytics_cumulative", true) ? (
              <TwoLineIndexedChart
                title="Cumulative return"
                subtitle="Cumulative % since inception (both start at 0%)"
                data={cumulativeSeries}
                markers={priceHistory?.rebalance_dates || []}
                benchmarkLabel={benchmarkLabel}
                percent
                onHide={() => setChartPref("analytics_cumulative", false)}
              />
            ) : null}

            <div className="grid gap-3 lg:grid-cols-2">
              {show("analytics_drawdown", true) ? (
                <TwoLineDrawdownChart
                  title="Drawdown"
                  data={drawdownSeries}
                  benchmarkLabel={benchmarkLabel}
                  onHide={() => setChartPref("analytics_drawdown", false)}
                />
              ) : null}
              {show("analytics_rolling_sharpe", true) ? (
                <RollingSharpeChart
                  title="Rolling Sharpe (6 snapshots)"
                  data={charts?.rolling_sharpe || []}
                  benchmarkLabel={benchmarkLabel}
                  onHide={() => setChartPref("analytics_rolling_sharpe", false)}
                />
              ) : null}
            </div>

          </div>
        )}
      </div>
    </PortfolioShell>
  );
}

