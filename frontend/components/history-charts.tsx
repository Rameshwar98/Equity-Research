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

function heatColor(rank: number | null) {
  if (rank == null) return "transparent";
  // 1..100 -> greener for lower rank
  const t = Math.min(1, Math.max(0, (rank - 1) / 99));
  const light = 92 - t * 45; // 92..47
  return `hsl(142 60% ${light}%)`;
}

export function RankHeatmap({
  columns,
  rows,
  onHide,
}: {
  columns: { key: string; label: string }[];
  rows: {
    symbol: string;
    name?: string | null;
    sector?: string | null;
    ranks_by_snapshot: Record<string, number | null>;
  }[];
  onHide?: () => void;
}) {
  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-foreground">Rank evolution (top-100 heatmap)</div>
            <div className="text-[11px] text-muted-foreground">Green = consistently high rank (lower is better)</div>
          </div>
          {onHide ? (
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onHide}>
              Hide
            </button>
          ) : null}
        </div>

        <div className="overflow-auto rounded-md border border-border">
          <div className="min-w-[900px]">
            <div
              className="grid"
              style={{ gridTemplateColumns: `220px repeat(${columns.length}, minmax(40px, 1fr))` }}
            >
              <div className="sticky left-0 z-10 border-b border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                Symbol
              </div>
              {columns.map((c, colIdx) => (
                <div
                  key={`${c.key}-${colIdx}`}
                  className="border-b border-border px-1 py-1 text-center text-[10px] text-muted-foreground"
                  title={c.label}
                >
                  {c.label.slice(5)}
                </div>
              ))}

              {rows.map((r) => (
                <React.Fragment key={r.symbol}>
                  <div className="sticky left-0 z-10 border-b border-border bg-background px-2 py-1 text-[11px]">
                    <div className="font-semibold text-foreground">{r.symbol}</div>
                    {r.sector ? <div className="text-[10px] text-muted-foreground">{r.sector}</div> : null}
                  </div>
                  {columns.map((c, colIdx) => {
                    const rank = r.ranks_by_snapshot[c.key] ?? null;
                    return (
                      <div
                        key={`${r.symbol}-${c.key}-${colIdx}`}
                        className="border-b border-border px-1 py-1 text-center text-[10px]"
                        style={{ backgroundColor: heatColor(rank) }}
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

