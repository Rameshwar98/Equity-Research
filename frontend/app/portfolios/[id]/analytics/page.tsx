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
import type {
  Portfolio,
  PortfolioAnalyticsResponse,
  PortfolioPriceHistoryResponse,
} from "@/lib/types";

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

        {/* KPI tiles */}
        <div className="grid gap-3 md:grid-cols-3">
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Sharpe ({k?.sharpe_rf_assumption || "vs 5% RF"})</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {k?.sharpe == null ? "—" : k.sharpe.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Sortino ({k?.sortino_rf_assumption || "vs 5% RF"})</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {k?.sortino == null ? "—" : k.sortino.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Quality score</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {k?.quality_score == null ? "—" : `${Math.round(k.quality_score * 100)}%`}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">High-return / low-vol vs top-100 medians</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Avg 12M return (holdings)</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {k?.avg_1y_return == null ? "—" : `${(k.avg_1y_return * 100).toFixed(1)}%`}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Avg annualized SD (holdings)</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {k?.avg_annualized_sd == null ? "—" : `${(k.avg_annualized_sd * 100).toFixed(1)}%`}
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Benchmark spread</div>
              <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                <div>1M</div>
                <div className="text-right text-foreground">{k?.spread_1m == null ? "—" : `${(k.spread_1m * 100).toFixed(1)}%`}</div>
                <div>3M</div>
                <div className="text-right text-foreground">{k?.spread_3m == null ? "—" : `${(k.spread_3m * 100).toFixed(1)}%`}</div>
                <div>YTD</div>
                <div className="text-right text-foreground">{k?.spread_ytd == null ? "—" : `${(k.spread_ytd * 100).toFixed(1)}%`}</div>
                <div>1Y</div>
                <div className="text-right text-foreground">{k?.spread_1y == null ? "—" : `${(k.spread_1y * 100).toFixed(1)}%`}</div>
              </div>
            </CardContent>
          </Card>
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
                title="Cumulative (indexed)"
                subtitle="Daily equity curve (indexed to 100 at inception)"
                data={dailySeries}
                markers={priceHistory?.rebalance_dates || []}
                benchmarkLabel={benchmarkLabel}
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

