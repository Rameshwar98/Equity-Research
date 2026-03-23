"use client";

import * as React from "react";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { StockDetailsResponse } from "@/lib/types";

type ChartPoint = {
  date: string;
  close: number | null;
  ema10?: number | null;
  ema20?: number | null;
  ema50?: number | null;
  signal?: string | null;
  volume?: number | null;
};

type Overlay = "ema10" | "ema20" | "ema50";

const OVERLAY_META: Record<Overlay, { label: string; color: string }> = {
  ema10: { label: "EMA 10", color: "#f59e0b" },
  ema20: { label: "EMA 20", color: "#8b5cf6" },
  ema50: { label: "EMA 50", color: "#06b6d4" },
};

function formatDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFull(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload as ChartPoint | undefined;
  if (!p) return null;

  const signal = p.signal;
  const signalColor =
    signal === "BUY"
      ? "text-emerald-600"
      : signal === "SELL"
        ? "text-rose-600"
        : "text-amber-600";

  return (
    <div className="rounded-lg border bg-background/95 backdrop-blur-sm px-3 py-2 shadow-lg text-xs space-y-1">
      <div className="font-medium text-foreground">{formatDateFull(p.date)}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-muted-foreground">Close</span>
        <span className="tabular-nums font-semibold">${p.close?.toFixed(2)}</span>
      </div>
      {p.ema10 != null && (
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: OVERLAY_META.ema10.color }}>EMA 10</span>
          <span className="tabular-nums">{p.ema10.toFixed(2)}</span>
        </div>
      )}
      {p.ema20 != null && (
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: OVERLAY_META.ema20.color }}>EMA 20</span>
          <span className="tabular-nums">{p.ema20.toFixed(2)}</span>
        </div>
      )}
      {p.ema50 != null && (
        <div className="flex items-center justify-between gap-4">
          <span style={{ color: OVERLAY_META.ema50.color }}>EMA 50</span>
          <span className="tabular-nums">{p.ema50.toFixed(2)}</span>
        </div>
      )}
      {p.volume != null && (
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Vol</span>
          <span className="tabular-nums">{(p.volume / 1e6).toFixed(1)}M</span>
        </div>
      )}
      {signal && signal !== "N/A" && (
        <div className={`font-semibold ${signalColor}`}>{signal}</div>
      )}
    </div>
  );
}

export function PriceChart({ data }: { data: StockDetailsResponse }) {
  const chartData = data.chart_data;
  if (!chartData || chartData.length === 0) return null;

  const [overlays, setOverlays] = React.useState<Set<Overlay>>(
    new Set(["ema20"])
  );
  const [showVolume, setShowVolume] = React.useState(true);
  const [showFib, setShowFib] = React.useState(false);

  const hasVolume = chartData.some((d) => d.volume != null && d.volume > 0);

  const toggle = (key: Overlay) => {
    setOverlays((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const closePrices = chartData
    .map((d) => d.close)
    .filter((c): c is number => c != null);
  const allValues = [
    ...closePrices,
    ...(overlays.has("ema10")
      ? chartData.map((d) => d.ema10).filter((v): v is number => v != null)
      : []),
    ...(overlays.has("ema20")
      ? chartData.map((d) => d.ema20).filter((v): v is number => v != null)
      : []),
    ...(overlays.has("ema50")
      ? chartData.map((d) => d.ema50).filter((v): v is number => v != null)
      : []),
  ];
  const minVal = Math.min(...allValues);
  const maxVal = Math.max(...allValues);
  const padding = (maxVal - minVal) * 0.05;
  const yDomain: [number, number] = [
    Math.floor((minVal - padding) * 100) / 100,
    Math.ceil((maxVal + padding) * 100) / 100,
  ];

  const maxVol = hasVolume
    ? Math.max(...chartData.map((d) => d.volume ?? 0))
    : 0;

  const fibLevels = showFib
    ? [
        { value: data.fib.high_52week, label: "52W H", color: "#10b981" },
        { value: data.fib.fib_61_8, label: "61.8%", color: "#6ee7b7" },
        { value: data.fib.fib_50, label: "50%", color: "#94a3b8" },
        { value: data.fib.fib_38_2, label: "38.2%", color: "#fca5a5" },
        { value: data.fib.fib_23_6, label: "23.6%", color: "#f87171" },
        { value: data.fib.low_52week, label: "52W L", color: "#ef4444" },
      ].filter((l) => l.value != null)
    : [];

  const tickInterval = Math.max(1, Math.floor(chartData.length / 6));

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {(Object.keys(OVERLAY_META) as Overlay[]).map((key) => (
          <button
            key={key}
            onClick={() => toggle(key)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all ${
              overlays.has(key)
                ? "border-current opacity-100"
                : "border-transparent opacity-40 hover:opacity-70"
            }`}
            style={{ color: OVERLAY_META[key].color }}
          >
            {OVERLAY_META[key].label}
          </button>
        ))}
        {hasVolume && (
          <button
            onClick={() => setShowVolume((v) => !v)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all ${
              showVolume
                ? "border-slate-400 text-slate-500 opacity-100"
                : "border-transparent text-slate-400 opacity-40 hover:opacity-70"
            }`}
          >
            Vol
          </button>
        )}
        <button
          onClick={() => setShowFib((v) => !v)}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium border transition-all ${
            showFib
              ? "border-orange-400 text-orange-500 opacity-100"
              : "border-transparent text-orange-400 opacity-40 hover:opacity-70"
          }`}
        >
          Fib
        </button>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart
          data={chartData}
          margin={{ top: 4, right: 4, bottom: 0, left: -10 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="hsl(var(--border))"
            opacity={0.4}
          />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            interval={tickInterval}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={42}
          />

          {hasVolume && showVolume && (
            <Bar
              dataKey="volume"
              yAxisId="vol"
              fill="hsl(var(--muted-foreground))"
              opacity={0.12}
              barSize={2}
              isAnimationActive={false}
            />
          )}

          {fibLevels.map((fl) => (
            <ReferenceLine
              key={fl.label}
              y={fl.value!}
              stroke={fl.color}
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{
                value: `${fl.label} ${fl.value!.toFixed(0)}`,
                position: "right",
                fontSize: 8,
                fill: fl.color,
              }}
            />
          ))}

          {overlays.has("ema50") && (
            <Line
              type="monotone"
              dataKey="ema50"
              stroke={OVERLAY_META.ema50.color}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {overlays.has("ema20") && (
            <Line
              type="monotone"
              dataKey="ema20"
              stroke={OVERLAY_META.ema20.color}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {overlays.has("ema10") && (
            <Line
              type="monotone"
              dataKey="ema10"
              stroke={OVERLAY_META.ema10.color}
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
            />
          )}

          <Line
            type="monotone"
            dataKey="close"
            stroke="hsl(var(--foreground))"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />

          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: "hsl(var(--muted-foreground))",
              strokeDasharray: "3 3",
            }}
          />

          {hasVolume && showVolume && (
            <YAxis
              yAxisId="vol"
              orientation="right"
              domain={[0, maxVol * 5]}
              hide
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
