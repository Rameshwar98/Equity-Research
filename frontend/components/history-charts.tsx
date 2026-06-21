"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent } from "@/components/ui/card";

export function TurnoverBarChart({
  data,
  onHide,
}: {
  data: { effective_date: string; turnover_pct: number }[];
  onHide?: () => void;
}) {
  const mapped = data.map((d) => ({
    date: d.effective_date,
    turnover: d.turnover_pct,
  }));
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">Turnover</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="min-h-[240px]">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={mapped} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(v) => `${Math.round(Number(v) * 100)}%`}
              />
              <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
              <Bar dataKey="turnover" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

export function DurationHistogram({
  data,
  onHide,
}: {
  data: { label: string; count: number }[];
  onHide?: () => void;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">Holding duration (snapshots)</div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>
        <div className="min-h-[220px]">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" fill="#94a3b8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

// Darker green = better rank (lower number, e.g. rank 1). Lighter = worse rank.
function heatColor(rank: number | null) {
  if (rank == null) return "transparent";
  // 1..100 -> darker for lower rank (better)
  const t = Math.min(1, Math.max(0, (rank - 1) / 99));
  const light = 42 + t * 50; // rank 1 -> 42% (dark), rank 100 -> 92% (light)
  return `hsl(142 60% ${light}%)`;
}

// Keep cell text legible on dark backgrounds.
function heatTextColor(rank: number | null) {
  if (rank == null) return undefined;
  const t = Math.min(1, Math.max(0, (rank - 1) / 99));
  const light = 42 + t * 50;
  return light < 60 ? "#ffffff" : "hsl(var(--foreground))";
}

type HeatRow = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  ranks_by_snapshot: Record<string, number | null>;
};

type HeatSort = "symbol" | "latest" | "avg";

function avgRank(r: HeatRow, columns: { key: string }[]): number {
  const vals = columns
    .map((c) => r.ranks_by_snapshot[c.key])
    .filter((v): v is number => typeof v === "number");
  if (!vals.length) return Number.POSITIVE_INFINITY;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function latestRank(r: HeatRow, columns: { key: string }[]): number {
  for (let i = columns.length - 1; i >= 0; i--) {
    const v = r.ranks_by_snapshot[columns[i]!.key];
    if (typeof v === "number") return v;
  }
  return Number.POSITIVE_INFINITY;
}

function fmtColLabel(label: string): { year: string; bottom: string } {
  // label = YYYY-MM-DD
  const d = new Date(label + "T00:00:00");
  const mon = d.toLocaleDateString("en-US", { month: "short" });
  const day = d.getDate();
  return { year: `'${label.slice(2, 4)}`, bottom: `${mon} ${day}` };
}

export function RankHeatmap({
  columns,
  rows,
  onHide,
}: {
  columns: { key: string; label: string }[];
  rows: HeatRow[];
  onHide?: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const [sector, setSector] = React.useState("all");
  const [sort, setSort] = React.useState<HeatSort>("avg");

  // Newest snapshot first (latest date directly after the Symbol column).
  const displayCols = React.useMemo(() => [...columns].reverse(), [columns]);

  const sectors = React.useMemo(
    () => Array.from(new Set(rows.map((r) => r.sector).filter((s): s is string => !!s))).sort(),
    [rows]
  );

  const visibleRows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (sector !== "all" && (r.sector || "") !== sector) return false;
      if (!q) return true;
      return (
        r.symbol.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)
      );
    });
    const sorted = [...filtered];
    if (sort === "symbol") {
      sorted.sort((a, b) => a.symbol.localeCompare(b.symbol));
    } else if (sort === "latest") {
      sorted.sort((a, b) => latestRank(a, columns) - latestRank(b, columns) || a.symbol.localeCompare(b.symbol));
    } else {
      sorted.sort((a, b) => avgRank(a, columns) - avgRank(b, columns) || a.symbol.localeCompare(b.symbol));
    }
    return sorted;
  }, [rows, columns, query, sector, sort]);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground">Rank evolution (top-100 heatmap)</div>
            <div className="text-[11px] text-muted-foreground">Darker green = better rank (lower number)</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter symbol…"
              className="h-7 w-[130px] rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <select
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="all">All sectors</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as HeatSort)}
              className="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              title="Sort rows"
            >
              <option value="avg">Sort: Avg rank</option>
              <option value="latest">Sort: Latest rank</option>
              <option value="symbol">Sort: Symbol A–Z</option>
            </select>
            {onHide ? (
              <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
                Hide
              </button>
            ) : null}
          </div>
        </div>

        <div className="overflow-auto rounded-md border border-border">
          <div className="min-w-[900px]">
            <div
              className="grid"
              style={{ gridTemplateColumns: `220px repeat(${displayCols.length}, minmax(44px, 1fr))` }}
            >
              <div className="sticky left-0 z-10 border-b border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                Symbol
              </div>
              {displayCols.map((c, colIdx) => {
                const prevCol = colIdx > 0 ? displayCols[colIdx - 1] : null;
                const yearChanged = prevCol != null && c.label.slice(0, 4) !== prevCol.label.slice(0, 4);
                const { year, bottom } = fmtColLabel(c.label);
                return (
                  <div
                    key={`${c.key}-${colIdx}`}
                    className={[
                      "border-b border-border px-1 py-1 text-center text-[10px]",
                      yearChanged ? "border-l-2 border-l-primary/20" : "",
                    ].join(" ")}
                    title={c.label}
                  >
                    <div className={[
                      "text-[9px] font-medium",
                      yearChanged ? "text-primary/80" : "text-muted-foreground/50",
                    ].join(" ")}>{year}</div>
                    <div className="text-muted-foreground">{bottom}</div>
                  </div>
                );
              })}

              {visibleRows.map((r) => (
                <React.Fragment key={r.symbol}>
                  <div className="sticky left-0 z-10 border-b border-border bg-background px-2 py-1 text-[11px]">
                    <div className="font-semibold text-foreground">{r.symbol}</div>
                    {r.sector ? <div className="text-[10px] text-muted-foreground">{r.sector}</div> : null}
                  </div>
                  {displayCols.map((c, colIdx) => {
                    const rank = r.ranks_by_snapshot[c.key] ?? null;
                    return (
                      <div
                        key={`${r.symbol}-${c.key}-${colIdx}`}
                        className="border-b border-border px-1 py-1 text-center text-[10px]"
                        style={{ backgroundColor: heatColor(rank), color: heatTextColor(rank) }}
                        title={rank == null ? "—" : `Rank ${rank}`}
                      >
                        {rank == null ? "" : rank}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

