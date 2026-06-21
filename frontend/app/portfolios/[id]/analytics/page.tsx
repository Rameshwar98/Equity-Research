"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import {
  AnalyticsScatter,
  RollingSharpeChart,
  TwoLineDrawdownChart,
  TwoLineIndexedChart,
} from "@/components/analytics-charts";
import { RankDistributionChart, ReturnVolScatter, SectorDonut } from "@/components/holdings-charts";
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

const NOTIONAL_CAPITAL = 100000;

function fmtP(v?: number | null, digits = 2) {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
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
  const onDeck = charts?.on_deck || [];
  const top100 = charts?.scatter_top100 || [];
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

  // Position P&L on a notional, equal-weight $100k basis (the strategy targets equal weights;
  // it has no real cash), derived from per-holding entry/current prices in price tracking.
  // Restricted to CURRENT holdings — the P&L ledger also carries exited positions.
  const positionPnl = React.useMemo(() => {
    const rows = (priceHistory?.holdings_pnl || []).filter(
      (r) => typeof r.entry_price === "number" && r.entry_price > 0 && heldSymbols.has(r.symbol)
    );
    const n = rows.length;
    if (!n) return null;
    const costEach = NOTIONAL_CAPITAL / n;
    const mvs = rows.map((r) => {
      const cur = typeof r.current_price === "number" && r.current_price > 0 ? r.current_price : r.entry_price;
      const shares = costEach / r.entry_price;
      return shares * cur;
    });
    const totalMV = mvs.reduce((a, b) => a + b, 0);
    const totalCost = NOTIONAL_CAPITAL;
    const gl = totalMV - totalCost;
    const largest = totalMV > 0 ? Math.max(...mvs) / totalMV : 0;
    const hhi = totalMV > 0 ? mvs.reduce((a, mv) => a + (mv / totalMV) ** 2, 0) : 0;
    return { totalMV, totalCost, gl, retPct: gl / totalCost, n, largest, hhi };
  }, [priceHistory, heldSymbols]);

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
      { key: "analytics_scatter", label: "Return vs Vol" },
      { key: "analytics_sector_donut", label: "Sector exposure" },
      { key: "analytics_rank_distribution", label: "Rank distribution" },
      { key: "analytics_return_vol_scatter", label: "Return vs volatility" },
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
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            title="Return"
            accent="#5b8cff"
            metrics={[
              { label: "Cumulative Return", value: fmtP(k?.cumulative_return), desc: "Total growth, all periods" },
              { label: "Annualized (CAGR)", value: fmtP(k?.cagr), desc: "Geometric, annualized" },
              { label: "Avg Periodic Return", value: fmtP(k?.avg_periodic_return), desc: "Mean monthly return" },
              { label: "Benchmark Cumulative", value: fmtP(k?.benchmark_cumulative), desc: benchmarkLabel ? `vs ${benchmarkLabel}` : "Benchmark" },
              { label: "Excess Return (cum.)", value: fmtP(k?.excess_return_cum), desc: "Portfolio − benchmark", valueClass: signClass(k?.excess_return_cum) },
              { label: "Best Period", value: fmtP(k?.best_period), desc: "Best month", valueClass: "text-emerald-600 dark:text-emerald-400" },
              { label: "Worst Period", value: fmtP(k?.worst_period), desc: "Worst month", valueClass: "text-rose-600 dark:text-rose-400" },
              { label: "Win Rate", value: fmtP(k?.win_rate), desc: "% positive months" },
            ]}
          />
          <MetricCard
            title="Risk"
            accent="#e0a92e"
            metrics={[
              { label: "Volatility (ann.)", value: fmtP(k?.volatility_annualized), desc: "Std dev of returns" },
              { label: "Downside Deviation", value: fmtP(k?.downside_deviation), desc: "Below target (MAR 0%)" },
              { label: "Beta", value: fmtN(k?.beta), desc: benchmarkLabel ? `vs ${benchmarkLabel}` : "vs benchmark" },
              { label: "Tracking Error", value: fmtP(k?.tracking_error), desc: "Std dev of excess" },
              { label: "Maximum Drawdown", value: fmtP(k?.max_drawdown), desc: "Worst peak-to-trough", valueClass: "text-rose-600 dark:text-rose-400" },
              { label: "Value at Risk (95%)", value: fmtP(k?.var_95), desc: "5th-pctile month", valueClass: "text-rose-600 dark:text-rose-400" },
              { label: "R-squared", value: fmtN(k?.r_squared), desc: "Fit vs benchmark" },
            ]}
          />
          <MetricCard
            title="Risk-adjusted"
            accent="#a78bfa"
            metrics={[
              { label: "Sharpe", value: fmtN(k?.sharpe), desc: k?.sharpe_rf_assumption || "vs RF" },
              { label: "Sortino", value: fmtN(k?.sortino), desc: "Per downside risk" },
              { label: "Treynor", value: fmtN(k?.treynor), desc: "Per unit beta" },
              { label: "Information Ratio", value: fmtN(k?.information_ratio), desc: "Active return / TE" },
              { label: "Calmar", value: fmtN(k?.calmar), desc: "CAGR / max drawdown" },
              { label: "Jensen's Alpha", value: fmtP(k?.jensens_alpha), desc: "Above CAPM (ann.)", valueClass: signClass(k?.jensens_alpha) },
            ]}
          />
          <MetricCard
            title="Position P&L"
            accent="#2fbf71"
            metrics={
              positionPnl
                ? [
                    { label: "Total Market Value", value: fmtMoney(positionPnl.totalMV), desc: "Notional $100k equal-weight" },
                    { label: "Total Cost Basis", value: fmtMoney(positionPnl.totalCost), desc: "Notional" },
                    { label: "Unrealized Gain/Loss", value: fmtMoney(positionPnl.gl), valueClass: signClass(positionPnl.gl) },
                    { label: "Unrealized Return %", value: fmtP(positionPnl.retPct), valueClass: signClass(positionPnl.retPct) },
                    { label: "Number of Holdings", value: String(positionPnl.n) },
                    { label: "Largest Position", value: fmtP(positionPnl.largest), desc: "Concentration check" },
                    { label: "Concentration (HHI)", value: fmtN(positionPnl.hhi, 4), desc: "Lower = diversified" },
                  ]
                : [{ label: "Position P&L", value: "—", desc: "Needs daily price tracking" }]
            }
          />
        </div>

        {/* Extras preserved from the prior view */}
        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard
            title="Holdings snapshot"
            metrics={[
              { label: "Quality Score", value: k?.quality_score == null ? "—" : fmtP(k?.quality_score, 0), desc: "High-return / low-vol vs top-100" },
              { label: "Avg 12M Return (holdings)", value: fmtP(k?.avg_1y_return, 1), desc: "Cross-sectional" },
              { label: "Avg Annualized SD (holdings)", value: fmtP(k?.avg_annualized_sd, 1) },
            ]}
          />
          <MetricCard
            title="Benchmark spread (excess return)"
            metrics={[
              { label: "1 Month", value: fmtP(k?.spread_1m, 1), valueClass: signClass(k?.spread_1m) },
              { label: "3 Months", value: fmtP(k?.spread_3m, 1), valueClass: signClass(k?.spread_3m) },
              { label: "YTD", value: fmtP(k?.spread_ytd, 1), valueClass: signClass(k?.spread_ytd) },
              { label: "1 Year", value: fmtP(k?.spread_1y, 1), valueClass: signClass(k?.spread_1y) },
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
            {/* Holdings overview (moved from Holdings page) */}
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              {show("analytics_sector_donut", true) ? (
                <SectorDonut holdings={holdings} onHide={() => setChartPref("analytics_sector_donut", false)} />
              ) : null}
              {show("analytics_rank_distribution", true) ? (
                <RankDistributionChart
                  holdings={holdings}
                  onDeck={onDeck}
                  onHide={() => setChartPref("analytics_rank_distribution", false)}
                />
              ) : null}
              {show("analytics_return_vol_scatter", true) ? (
                <ReturnVolScatter
                  top100={top100}
                  heldSymbols={heldSymbols}
                  onHide={() => setChartPref("analytics_return_vol_scatter", false)}
                />
              ) : null}
            </div>

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

            {show("analytics_scatter", true) ? (
              <AnalyticsScatter
                title="Return vs Vol (holdings vs top-100)"
                holdings={charts?.scatter_holdings || []}
                top100={charts?.scatter_top100 || []}
                medianReturn={charts?.scatter_median_return_1y}
                medianSd={charts?.scatter_median_sd}
                onHide={() => setChartPref("analytics_scatter", false)}
              />
            ) : null}

            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="text-sm font-semibold text-foreground">Concentration</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3 text-sm">
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Herfindahl (sectors)</div>
                    <div className="mt-1 font-semibold text-foreground">
                      {charts?.concentration?.herfindahl == null ? "—" : charts.concentration.herfindahl.toFixed(2)}
                    </div>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Max sector weight</div>
                    <div className="mt-1 font-semibold text-foreground">
                      {charts?.concentration?.max_sector_weight == null
                        ? "—"
                        : `${(charts.concentration.max_sector_weight * 100).toFixed(0)}%`}
                    </div>
                  </div>
                  <div className="rounded-md border border-border p-3">
                    <div className="text-xs text-muted-foreground">Distinct sectors</div>
                    <div className="mt-1 font-semibold text-foreground">
                      {charts?.concentration?.distinct_sectors ?? "—"}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </PortfolioShell>
  );
}

