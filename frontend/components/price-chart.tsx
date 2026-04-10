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

type ChartPoint = NonNullable<StockDetailsResponse["chart_data"]>[number];

type EmaKey = "ema10" | "ema20" | "ema30" | "ema50" | "ema100" | "ema200";

const EMA_META: Record<EmaKey, { label: string; color: string }> = {
  ema10:  { label: "EMA 10",  color: "#f59e0b" },
  ema20:  { label: "EMA 20",  color: "#8b5cf6" },
  ema30:  { label: "EMA 30",  color: "#ec4899" },
  ema50:  { label: "EMA 50",  color: "#06b6d4" },
  ema100: { label: "EMA 100", color: "#14b8a6" },
  ema200: { label: "EMA 200", color: "#6366f1" },
};

function formatDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDateFull(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** Drives heatmap sync + hovered bar for the stats strip; renders no overlay (keeps chart clear). */
function ChartHoverBridge({
  active,
  payload,
  onHoverPoint,
  onSyncHoverDate,
}: {
  active?: boolean;
  payload?: { payload?: ChartPoint }[];
  onHoverPoint: (p: ChartPoint | null) => void;
  onSyncHoverDate?: (date: string | null) => void;
}) {
  const p =
    active && payload?.[0]?.payload != null ? (payload[0].payload as ChartPoint) : null;
  const date = p?.date != null ? String(p.date) : null;
  React.useLayoutEffect(() => {
    onSyncHoverDate?.(date);
    onHoverPoint(p);
  }, [date, p, onHoverPoint, onSyncHoverDate]);
  return null;
}

function StatSep() {
  return <span className="text-border select-none" aria-hidden>|</span>;
}

/** Price / volume / signal stats for the bar under the toggles (replaces hover tooltip). */
function PriceStatsStrip({
  p,
  emaKeys,
  showVolume,
  hasVolume,
  showRsi,
  showMacd,
}: {
  p: ChartPoint;
  emaKeys: Set<EmaKey>;
  showVolume: boolean;
  hasVolume: boolean;
  showRsi: boolean;
  showMacd: boolean;
}) {
  return (
    <div className="mb-2 rounded-md border border-border/70 bg-muted/25 px-2 py-1.5 text-[11px] leading-snug">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-semibold text-foreground">{formatDateFull(p.date)}</span>
        <StatSep />
        <span className="text-muted-foreground">Close</span>
        <span className="tabular-nums font-semibold text-foreground">${p.close?.toFixed(2)}</span>
        {(Object.keys(EMA_META) as EmaKey[]).map((k) => {
          if (!emaKeys.has(k)) return null;
          const v = p[k];
          if (v == null) return null;
          return (
            <React.Fragment key={k}>
              <StatSep />
              <span style={{ color: EMA_META[k].color }}>{EMA_META[k].label}</span>
              <span className="tabular-nums text-foreground">{v.toFixed(2)}</span>
            </React.Fragment>
          );
        })}
        {showVolume && hasVolume && p.volume != null && (
          <>
            <StatSep />
            <span className={p.priceUp ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
              Vol
            </span>
            <span className="tabular-nums">{(p.volume / 1e6).toFixed(2)}M</span>
          </>
        )}
        {showVolume && hasVolume && p.volEma5 != null && (
          <>
            <StatSep />
            <span style={{ color: "#f59e0b" }}>EMA 5</span>
            <span className="tabular-nums">{(p.volEma5 / 1e6).toFixed(2)}M</span>
          </>
        )}
        {showVolume && hasVolume && p.volRatio != null && (
          <>
            <StatSep />
            <span className="text-muted-foreground">vs 20D</span>
            <span className="tabular-nums font-medium">{p.volRatio.toFixed(2)}×</span>
          </>
        )}
        {showRsi && p.rsi != null && (
          <>
            <StatSep />
            <span className="text-purple-600 dark:text-purple-400">RSI</span>
            <span className="tabular-nums">{p.rsi.toFixed(1)}</span>
          </>
        )}
        {showMacd && (p.macd != null || p.macdSignal != null || p.macdHist != null) && (
          <>
            <StatSep />
            {p.macd != null && (
              <>
                <span style={{ color: "#3b82f6" }}>MACD</span>
                <span className="tabular-nums mr-1">{p.macd.toFixed(2)}</span>
              </>
            )}
            {p.macdSignal != null && (
              <>
                <span style={{ color: "#f97316" }}>Sig</span>
                <span className="tabular-nums mr-1">{p.macdSignal.toFixed(2)}</span>
              </>
            )}
            {p.macdHist != null && (
              <>
                <span className="text-muted-foreground">Hist</span>
                <span className="tabular-nums">{p.macdHist.toFixed(2)}</span>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ToggleBtn({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium border transition-all ${
        active ? "border-current opacity-100" : "border-transparent opacity-40 hover:opacity-70"
      }`}
      style={{ color }}
    >
      {children}
    </button>
  );
}

export function PriceChart({
  data,
  syncHoverDate,
  onSyncHoverDate,
}: {
  data: StockDetailsResponse;
  /** When set (e.g. from signal heatmap), draws a vertical guide on the price chart. */
  syncHoverDate?: string | null;
  /** Called when the chart tooltip active date changes (for heatmap highlight). */
  onSyncHoverDate?: (date: string | null) => void;
}) {
  const chartData = data.chart_data;
  if (!chartData || chartData.length === 0) return null;

  const [emaOverlays, setEmaOverlays] = React.useState<Set<EmaKey>>(new Set(["ema20"]));
  const [showVolume, setShowVolume] = React.useState(true);
  const [showFib, setShowFib] = React.useState(false);
  const [showRsi, setShowRsi] = React.useState(false);
  const [showMacd, setShowMacd] = React.useState(false);
  /** null = show latest bar in strip; non-null = crosshair bar */
  const [hoverPoint, setHoverPoint] = React.useState<ChartPoint | null>(null);

  const onHoverPoint = React.useCallback((p: ChartPoint | null) => {
    setHoverPoint(p);
  }, []);

  const stripPoint = hoverPoint ?? chartData[chartData.length - 1]!;

  const hasVolume = chartData.some((d) => d.volume != null && d.volume > 0);
  const hasRsi = chartData.some((d) => d.rsi != null);
  const hasMacd = chartData.some((d) => d.macd != null);
  const maxVolumeVal = hasVolume ? Math.max(...chartData.map((d) => d.volume ?? 0)) : 0;

  const toggleEma = (key: EmaKey) => {
    setEmaOverlays((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Y-domain for price chart
  const priceValues = [
    ...chartData.map((d) => d.close).filter((v): v is number => v != null),
    ...(Array.from(emaOverlays) as EmaKey[]).flatMap((k) =>
      chartData.map((d) => d[k]).filter((v): v is number => v != null)
    ),
  ];
  const minP = Math.min(...priceValues);
  const maxP = Math.max(...priceValues);
  const pad = (maxP - minP) * 0.05;
  const yDomain: [number, number] = [
    Math.floor((minP - pad) * 100) / 100,
    Math.ceil((maxP + pad) * 100) / 100,
  ];

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
  const xAxisProps = {
    dataKey: "date" as const,
    tickFormatter: formatDate,
    tick: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
    tickLine: false,
    axisLine: false,
    interval: tickInterval,
  };
  const gridProps = { strokeDasharray: "3 3", stroke: "hsl(var(--border))", opacity: 0.4 };
  const cursorProps = { stroke: "hsl(var(--muted-foreground))", strokeDasharray: "3 3" };

  const tooltipBridge = React.useCallback(
    (props: Record<string, unknown>) => (
      <ChartHoverBridge
        {...(props as { active?: boolean; payload?: { payload?: ChartPoint }[] })}
        onHoverPoint={onHoverPoint}
        onSyncHoverDate={onSyncHoverDate}
      />
    ),
    [onHoverPoint, onSyncHoverDate]
  );

  const showSyncRefLine =
    !!syncHoverDate && chartData.some((d) => d.date === syncHoverDate);

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {(Object.keys(EMA_META) as EmaKey[]).map((key) => (
          <ToggleBtn key={key} active={emaOverlays.has(key)} color={EMA_META[key].color} onClick={() => toggleEma(key)}>
            {EMA_META[key].label}
          </ToggleBtn>
        ))}
        {hasVolume && (
          <ToggleBtn active={showVolume} color="#64748b" onClick={() => setShowVolume((v) => !v)}>Vol</ToggleBtn>
        )}
        <ToggleBtn active={showFib} color="#f97316" onClick={() => setShowFib((v) => !v)}>Fib</ToggleBtn>
        {hasRsi && (
          <ToggleBtn active={showRsi} color="#a855f7" onClick={() => setShowRsi((v) => !v)}>RSI</ToggleBtn>
        )}
        {hasMacd && (
          <ToggleBtn active={showMacd} color="#3b82f6" onClick={() => setShowMacd((v) => !v)}>MACD</ToggleBtn>
        )}
      </div>

      {stripPoint && (
        <PriceStatsStrip
          p={stripPoint}
          emaKeys={emaOverlays}
          showVolume={showVolume}
          hasVolume={hasVolume}
          showRsi={showRsi && hasRsi}
          showMacd={showMacd && hasMacd}
        />
      )}

      {/* Combined Price + Volume Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -10 }} syncId="stock-chart">
          <CartesianGrid {...gridProps} />
          <XAxis {...xAxisProps} />
          <YAxis
            yAxisId="price"
            domain={yDomain}
            tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => v.toFixed(0)}
            width={42}
          />
          {showVolume && hasVolume && (
            <YAxis
              yAxisId="volume"
              orientation="right"
              domain={[0, maxVolumeVal * 4]}
              hide
            />
          )}

          {showVolume && hasVolume && (
            <Bar yAxisId="volume" dataKey="volume" isAnimationActive={false} barSize={3}>
              {chartData.map((entry, idx) => (
                <rect
                  key={idx}
                  fill={entry.priceUp ? "#22c55e" : "#ef4444"}
                  fillOpacity={0.25}
                />
              ))}
            </Bar>
          )}
          {showVolume && hasVolume && (
            <Line yAxisId="volume" type="monotone" dataKey="volEma5" stroke="#f59e0b" strokeWidth={1} dot={false} isAnimationActive={false} />
          )}

          {fibLevels.map((fl) => (
            <ReferenceLine
              key={fl.label}
              yAxisId="price"
              y={fl.value!}
              stroke={fl.color}
              strokeDasharray="4 3"
              strokeWidth={1}
              label={{ value: `${fl.label} ${fl.value!.toFixed(0)}`, position: "right", fontSize: 10, fill: fl.color }}
            />
          ))}

          {(["ema200", "ema100", "ema50", "ema30", "ema20", "ema10"] as EmaKey[]).map(
            (k) =>
              emaOverlays.has(k) && (
                <Line key={k} yAxisId="price" type="monotone" dataKey={k} stroke={EMA_META[k].color} strokeWidth={1} dot={false} isAnimationActive={false} />
              )
          )}

          <Line yAxisId="price" type="monotone" dataKey="close" stroke="hsl(var(--foreground))" strokeWidth={1.5} dot={false} isAnimationActive={false} />

          {showSyncRefLine && (
            <ReferenceLine
              x={syncHoverDate!}
              yAxisId="price"
              stroke="hsl(var(--primary))"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          )}

          <Tooltip
            content={tooltipBridge}
            cursor={cursorProps}
            wrapperStyle={{ visibility: "hidden", pointerEvents: "none" }}
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* RSI Sub-chart */}
      {showRsi && hasRsi && (
        <div className="mt-1">
          <div className="text-xs text-muted-foreground font-semibold mb-1 pl-1">RSI (14)</div>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -10 }} syncId="stock-chart">
              <CartesianGrid {...gridProps} />
              <XAxis {...xAxisProps} tick={false} height={0} />
              <YAxis
                domain={[0, 100]}
                ticks={[30, 50, 70]}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={42}
              />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" strokeWidth={0.5} />
              <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" strokeWidth={0.5} />
              <Line type="monotone" dataKey="rsi" stroke="#a855f7" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Tooltip
                content={tooltipBridge}
                cursor={cursorProps}
                wrapperStyle={{ visibility: "hidden", pointerEvents: "none" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* MACD Sub-chart */}
      {showMacd && hasMacd && (
        <div className="mt-1">
          <div className="text-xs text-muted-foreground font-semibold mb-1 pl-1">MACD (12, 26, 9)</div>
          <ResponsiveContainer width="100%" height={80}>
            <ComposedChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -10 }} syncId="stock-chart">
              <CartesianGrid {...gridProps} />
              <XAxis {...xAxisProps} tick={false} height={0} />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                width={42}
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={0.5} />
              <Bar
                dataKey="macdHist"
                isAnimationActive={false}
                barSize={2}
              >
                {chartData.map((entry, idx) => {
                  const v = entry.macdHist ?? 0;
                  return (
                    <rect
                      key={idx}
                      fill={v >= 0 ? "#22c55e" : "#ef4444"}
                      fillOpacity={0.5}
                    />
                  );
                })}
              </Bar>
              <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="macdSignal" stroke="#f97316" strokeWidth={1} dot={false} isAnimationActive={false} />
              <Tooltip
                content={tooltipBridge}
                cursor={cursorProps}
                wrapperStyle={{ visibility: "hidden", pointerEvents: "none" }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
