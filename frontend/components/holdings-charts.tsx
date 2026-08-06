"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import type { MomentumComputedRow } from "@/lib/types";

function pct(n: number, d: number) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

const SECTOR_COLORS = [
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

export function SectorDonut({
  holdings,
  benchmarkSectors,
  benchmarkSectorLabel,
  benchmarkLabel,
  onHide,
}: {
  holdings: MomentumComputedRow[];
  /** sector -> weight 0..1 for the index constituent mix (optional). */
  benchmarkSectors?: Record<string, number> | null;
  benchmarkSectorLabel?: string | null;
  benchmarkLabel?: string | null;
  onHide?: () => void;
}) {
  const hasBench = !!benchmarkSectors && Object.keys(benchmarkSectors).length > 0;

  // Union of portfolio + benchmark sectors, so a sector the portfolio holds none of
  // still shows as a full underweight instead of vanishing.
  const data = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of holdings) {
      const key = (h.sector || "Unknown").trim() || "Unknown";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const n = Math.max(1, holdings.length);
    const sectors = new Set<string>([...counts.keys(), ...Object.keys(benchmarkSectors || {})]);
    const out = Array.from(sectors).map((sector) => {
      const count = counts.get(sector) || 0;
      const port = count / n;
      const bench = benchmarkSectors?.[sector];
      return {
        sector,
        count,
        port,
        bench: typeof bench === "number" ? bench : null,
        diff: typeof bench === "number" ? port - bench : null,
      };
    });
    out.sort((a, b) => b.port - a.port || (b.bench ?? 0) - (a.bench ?? 0) || a.sector.localeCompare(b.sector));
    return out;
  }, [holdings, benchmarkSectors]);

  // Only sectors actually held can be slices of the donut.
  const pieData = React.useMemo(() => data.filter((d) => d.count > 0), [data]);
  const colorFor = React.useCallback(
    (sector: string) => {
      const idx = pieData.findIndex((p) => p.sector === sector);
      return idx >= 0 ? SECTOR_COLORS[idx % SECTOR_COLORS.length]! : "#cbd5e1";
    },
    [pieData]
  );

  const fmtW = (v?: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
  const fmtDiff = (v?: number | null) => {
    if (v == null) return "—";
    const sign = v > 0 ? "+" : "";
    return `${sign}${(v * 100).toFixed(1)}%`;
  };
  const diffClass = (v?: number | null) => {
    if (v == null || Math.abs(v) < 0.0005) return "text-muted-foreground";
    return v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-foreground">Sector exposure</div>
            {hasBench ? (
              <div className="truncate text-[11px] text-muted-foreground" title={benchmarkSectorLabel || ""}>
                vs {benchmarkSectorLabel || benchmarkLabel || "benchmark"}
              </div>
            ) : null}
          </div>
          {onHide ? (
            <button
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
              onClick={onHide}
            >
              Hide
            </button>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="min-h-[220px]">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Tooltip
                  formatter={(value, name) => {
                    const v = Number(value ?? 0);
                    return [`${v} (${pct(v, holdings.length)})`, String(name ?? "")];
                  }}
                />
                <Pie
                  data={pieData}
                  dataKey="count"
                  nameKey="sector"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={1}
                >
                  {pieData.map((d) => (
                    <Cell key={d.sector} fill={colorFor(d.sector)} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1 pr-2 text-left font-medium">Sector</th>
                  <th className="py-1 pr-2 text-right font-medium">#</th>
                  <th className="py-1 pr-2 text-right font-medium">Port.</th>
                  {hasBench ? (
                    <>
                      <th className="py-1 pr-2 text-right font-medium">{benchmarkLabel || "Bench"}</th>
                      <th className="py-1 text-right font-medium">Diff</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.sector} className="border-t border-border/40">
                    <td className="py-1 pr-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: d.count > 0 ? colorFor(d.sector) : "transparent", border: d.count > 0 ? undefined : "1px dashed hsl(var(--border))" }}
                        />
                        <span className="truncate text-muted-foreground" title={d.sector}>
                          {d.sector}
                        </span>
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{d.count}</td>
                    <td className="py-1 pr-2 text-right font-medium tabular-nums text-foreground">
                      {fmtW(d.port)}
                    </td>
                    {hasBench ? (
                      <>
                        <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">
                          {fmtW(d.bench)}
                        </td>
                        <td className={`py-1 text-right font-medium tabular-nums ${diffClass(d.diff)}`}>
                          {fmtDiff(d.diff)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
                {!data.length ? (
                  <tr>
                    <td className="py-2 text-muted-foreground" colSpan={hasBench ? 5 : 3}>
                      No sector data.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {hasBench ? (
              <div className="mt-2 border-t border-border/40 pt-1.5 text-[10px] leading-relaxed text-muted-foreground">
                Diff = portfolio − index. Green = overweight, red = underweight. Index mix is
                equal-weight by constituent count, matching the portfolio&apos;s equal weighting
                (not {benchmarkLabel || "the ETF"}&apos;s cap weights).
              </div>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ScoreHistogram({
  holdings,
  holdThreshold,
  watchThreshold,
  onHide,
}: {
  holdings: MomentumComputedRow[];
  holdThreshold: number;
  watchThreshold: number;
  onHide?: () => void;
}) {
  const bins = React.useMemo(() => {
    const binSize = 10;
    const scores = holdings.map((h) => h.combined_score).filter((v) => Number.isFinite(v));
    if (!scores.length) return [];
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const start = Math.floor(min / binSize) * binSize;
    const end = Math.ceil(max / binSize) * binSize;
    const out: { bin: string; from: number; to: number; count: number }[] = [];
    for (let b = start; b < end; b += binSize) {
      out.push({ bin: `${b}-${b + binSize - 1}`, from: b, to: b + binSize, count: 0 });
    }
    for (const s of scores) {
      const idx = Math.min(out.length - 1, Math.max(0, Math.floor((s - start) / binSize)));
      out[idx]!.count += 1;
    }
    return out;
  }, [holdings]);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">Score distribution</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Bands: HOLD ≤ {holdThreshold} · WATCH ≤ {watchThreshold} · EXIT &gt; {watchThreshold}
        </div>
        <div className="mt-2 min-h-[220px]">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bins} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="bin" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} interval={0} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip />
              <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function RankDistributionChart({
  holdings,
  onDeck,
  onHide,
}: {
  holdings: MomentumComputedRow[];
  onDeck?: MomentumComputedRow[] | null;
  onHide?: () => void;
}) {
  const sectorColorBy = React.useMemo(() => {
    const sectors = Array.from(new Set(holdings.map((h) => (h.sector || "Unknown").trim() || "Unknown"))).sort(
      (a, b) => a.localeCompare(b)
    );
    const m = new Map<string, string>();
    sectors.forEach((s, i) => m.set(s, SECTOR_COLORS[i % SECTOR_COLORS.length]!));
    return m;
  }, [holdings]);

  const data = React.useMemo(() => {
    const sorted = [...holdings].sort((a, b) => a.combined_rank - b.combined_rank || a.symbol.localeCompare(b.symbol));
    return sorted.map((h) => ({
      rank: h.combined_rank,
      label: String(h.combined_rank),
      symbol: h.symbol,
      sector: (h.sector || "Unknown").trim() || "Unknown",
      combined_score: h.combined_score,
      name: h.name,
    }));
  }, [holdings]);

  const cutScore = React.useMemo(() => {
    const s = onDeck && onDeck.length ? onDeck[0]?.combined_score : null;
    return Number.isFinite(s as number) ? (s as number) : null;
  }, [onDeck]);

  const legend = React.useMemo(() => {
    return Array.from(sectorColorBy.entries()).map(([sector, color]) => ({ sector, color }));
  }, [sectorColorBy]);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">Rank distribution (top 25)</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Bars show combined score by rank. Dotted line = rank 26 score (cut line).
        </div>

        <div className="mt-2 min-h-[240px]">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                interval={0}
              />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <Tooltip
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.35 }}
                labelFormatter={(lbl) => `Rank ${lbl}`}
                formatter={(value, name, props) => {
                  const p = props?.payload as unknown as { symbol: string; sector: string };
                  return [
                    String(value),
                    `${p?.symbol ?? ""}${p?.sector ? ` · ${p.sector}` : ""}`,
                  ];
                }}
              />
              {cutScore != null ? (
                <ReferenceLine
                  y={cutScore}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                />
              ) : null}
              <Bar dataKey="combined_score" radius={[3, 3, 0, 0]}>
                {data.map((d) => (
                  <Cell key={d.symbol} fill={sectorColorBy.get(d.sector) || "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {legend.length ? (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {legend.map((l) => (
              <span key={l.sector} className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-sm" style={{ background: l.color }} />
                {l.sector}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ReturnVolScatter({
  top100,
  heldSymbols,
  onHide,
}: {
  top100: MomentumComputedRow[];
  heldSymbols: Set<string>;
  onHide?: () => void;
}) {
  const pts = React.useMemo(() => {
    return top100
      .filter((r) => Number.isFinite(r.annualized_sd) && Number.isFinite(r.return_1y))
      .map((r) => ({
        symbol: r.symbol,
        name: r.name,
        score: r.combined_score,
        x: r.annualized_sd,
        y: r.return_1y,
        held: heldSymbols.has(r.symbol),
      }));
  }, [top100, heldSymbols]);

  const held = pts.filter((p) => p.held);
  const rest = pts.filter((p) => !p.held);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">Return vs volatility (top 100)</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="text-[11px] text-muted-foreground">
          x = annualised SD · y = 12M return · holdings highlighted
        </div>
        <div className="mt-2 min-h-[260px]">
          <ResponsiveContainer width="100%" height={260}>
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
              />
              <Tooltip
                labelFormatter={() => ""}
                content={({ active, payload }) => {
                  const p =
                    active && payload?.[0]?.payload
                      ? (payload[0].payload as unknown as {
                          symbol: string;
                          name?: string | null;
                          score: number;
                          x: number;
                          y: number;
                        })
                      : null;
                  if (!p) return null;
                  return (
                    <div className="rounded-md border border-border bg-background px-2 py-1.5 text-[11px] shadow-sm">
                      <div className="font-semibold text-foreground">{p.symbol}</div>
                      {p.name ? <div className="text-muted-foreground">{p.name}</div> : null}
                      <div className="mt-1 text-muted-foreground">
                        Score <span className="font-medium text-foreground">{p.score}</span> · Return{" "}
                        <span className="font-medium text-foreground">{(p.y * 100).toFixed(1)}%</span> · SD{" "}
                        <span className="font-medium text-foreground">{(p.x * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                }}
              />
              <Legend />
              <Scatter name="Other (top 100)" data={rest} fill="hsl(var(--muted-foreground))" opacity={0.35} />
              <Scatter name="Holdings" data={held} fill="hsl(var(--primary))" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

