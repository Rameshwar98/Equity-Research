"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import type { AnalyticsSeriesPoint, MomentumComputedRow } from "@/lib/types";

function fmtPct(v: number) {
  if (!Number.isFinite(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

export function TwoLineIndexedChart({
  title,
  subtitle,
  data,
  markers,
  onHide,
  benchmarkLabel,
}: {
  title: string;
  subtitle?: string;
  data: AnalyticsSeriesPoint[];
  markers?: string[];
  onHide?: () => void;
  benchmarkLabel?: string | null;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            {subtitle ? <div className="text-[11px] text-muted-foreground">{subtitle}</div> : null}
          </div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="min-h-[260px]">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip />
              <Legend />
              {(markers || []).map((d) => (
                <ReferenceLine
                  key={d}
                  x={d}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="3 3"
                  opacity={0.35}
                />
              ))}
              <Line type="monotone" dataKey="portfolio" stroke="hsl(var(--primary))" dot={false} name="Portfolio" />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#94a3b8"
                dot={false}
                name={benchmarkLabel ? `Benchmark (${benchmarkLabel})` : "Benchmark"}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function TwoLineDrawdownChart({
  title,
  data,
  onHide,
  benchmarkLabel,
}: {
  title: string;
  data: AnalyticsSeriesPoint[];
  onHide?: () => void;
  benchmarkLabel?: string | null;
}) {
  // drawdown values are negative; show as %.
  const mapped = data.map((d) => ({
    date: d.date,
    portfolio: d.portfolio,
    benchmark: d.benchmark,
  }));
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="min-h-[220px]">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={mapped} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => fmtPct(Number(v))}
                domain={["dataMin", 0]}
              />
              <Tooltip formatter={(v) => fmtPct(Number(v))} />
              <Legend />
              <Area type="monotone" dataKey="portfolio" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.12} name="Portfolio" />
              <Area
                type="monotone"
                dataKey="benchmark"
                stroke="#94a3b8"
                fill="#94a3b8"
                fillOpacity={0.08}
                name={benchmarkLabel ? `Benchmark (${benchmarkLabel})` : "Benchmark"}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function RollingSharpeChart({
  title,
  data,
  onHide,
  benchmarkLabel,
}: {
  title: string;
  data: AnalyticsSeriesPoint[];
  onHide?: () => void;
  benchmarkLabel?: string | null;
}) {
  const cleaned = data.map((d) => ({
    ...d,
    portfolio: typeof d.portfolio === "number" && Number.isFinite(d.portfolio) ? d.portfolio : null,
    benchmark: typeof d.benchmark === "number" && Number.isFinite(d.benchmark) ? d.benchmark : null,
  }));
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="min-h-[220px]">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={cleaned} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="portfolio" stroke="hsl(var(--primary))" dot={false} name="Portfolio" connectNulls />
              <Line
                type="monotone"
                dataKey="benchmark"
                stroke="#94a3b8"
                dot={false}
                name={benchmarkLabel ? `Benchmark (${benchmarkLabel})` : "Benchmark"}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

const SECTOR_PALETTE = [
  "#60a5fa",
  "#34d399",
  "#fbbf24",
  "#f87171",
  "#a78bfa",
  "#22c55e",
  "#fb7185",
  "#38bdf8",
  "#f97316",
  "#94a3b8",
];

export function AnalyticsScatter({
  title,
  holdings,
  top100,
  medianReturn,
  medianSd,
  onHide,
}: {
  title: string;
  holdings: MomentumComputedRow[];
  top100: MomentumComputedRow[];
  medianReturn?: number | null;
  medianSd?: number | null;
  onHide?: () => void;
}) {
  const sectorColors = React.useMemo(() => {
    const sectors = Array.from(
      new Set(holdings.map((h) => h.sector || "Unknown"))
    ).sort();
    const m = new Map<string, string>();
    sectors.forEach((s, i) => m.set(s, SECTOR_PALETTE[i % SECTOR_PALETTE.length]!));
    return m;
  }, [holdings]);

  const holdPts = holdings
    .filter((h) => Number.isFinite(h.annualized_sd) && Number.isFinite(h.return_1y))
    .map((h) => ({
      symbol: h.symbol,
      name: h.name,
      sector: h.sector || "Unknown",
      x: h.annualized_sd,
      y: h.return_1y,
    }));

  const topPts = top100
    .filter((h) => Number.isFinite(h.annualized_sd) && Number.isFinite(h.return_1y))
    .map((h) => ({
      symbol: h.symbol,
      x: h.annualized_sd,
      y: h.return_1y,
    }));

  const yCap = React.useMemo(() => {
    const ys = topPts.map((p) => p.y).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (!ys.length) return null;
    ys.sort((a, b) => a - b);
    const idx = Math.max(0, Math.min(ys.length - 1, Math.floor((ys.length - 1) * 0.95)));
    return ys[idx]!;
  }, [topPts]);

  const filtered = React.useMemo(() => {
    if (yCap == null) return { topPts, holdPts, hidden: 0, hiddenSymbols: [] as string[] };
    const hiddenSymbols = topPts.filter((p) => p.y > yCap).map((p) => p.symbol);
    const topFiltered = topPts.filter((p) => p.y <= yCap);
    const holdFiltered = holdPts.filter((p) => p.y <= yCap);
    return {
      topPts: topFiltered,
      holdPts: holdFiltered,
      hidden: hiddenSymbols.length,
      hiddenSymbols,
    };
  }, [holdPts, topPts, yCap]);

  React.useEffect(() => {
    if (filtered.hidden > 0) {
      // Frontend console log so we can investigate data quality issues.
      console.warn("[AnalyticsScatter] Outliers hidden (return_1y >", yCap, "):", filtered.hiddenSymbols);
    }
  }, [filtered.hidden, filtered.hiddenSymbols, yCap]);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            {filtered.hidden > 0 ? (
              <div className="text-[11px] text-muted-foreground">{filtered.hidden} outliers hidden</div>
            ) : null}
          </div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="min-h-[320px]">
          <ResponsiveContainer width="100%" height={320}>
            <ScatterChart margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis
                type="number"
                dataKey="x"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                name="SD"
              />
              <YAxis
                type="number"
                dataKey="y"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
                name="Return"
                domain={yCap == null ? undefined : ["dataMin", yCap]}
              />
              <Tooltip
                labelFormatter={() => ""}
                content={({ active, payload }) => {
                  const p =
                    active && payload?.[0]?.payload
                      ? (payload[0].payload as unknown as {
                          symbol: string;
                          name?: string | null;
                          sector?: string | null;
                          x: number;
                          y: number;
                        })
                      : null;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] shadow-sm">
                      <div className="font-semibold text-foreground">{p.symbol}</div>
                      {p.name ? <div className="text-muted-foreground">{p.name}</div> : null}
                      {p.sector ? <div className="text-muted-foreground">{p.sector}</div> : null}
                      <div className="mt-1 text-muted-foreground">
                        Return <span className="font-medium text-foreground">{(p.y * 100).toFixed(1)}%</span> · SD{" "}
                        <span className="font-medium text-foreground">{(p.x * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Legend />
              <Scatter
                name="Top 100 (unselected)"
                data={filtered.topPts}
                fill="hsl(var(--muted-foreground))"
                opacity={0.25}
              />
              <Scatter name="Holdings (by sector)" data={filtered.holdPts} shape="circle">
                {filtered.holdPts.map((p, i) => (
                  <circle key={i} r={4} fill={sectorColors.get(p.sector) || "hsl(var(--primary))"} />
                ))}
              </Scatter>
              {medianSd != null ? <ReferenceLine x={medianSd} stroke="#94a3b8" strokeDasharray="3 3" /> : null}
              {medianReturn != null ? <ReferenceLine y={medianReturn} stroke="#94a3b8" strokeDasharray="3 3" /> : null}
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

