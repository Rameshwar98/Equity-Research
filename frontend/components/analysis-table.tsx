"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";

import { DashboardSignalHeatmap } from "@/components/dashboard-signal-heatmap";
import { SectorAggregateTable } from "@/components/sector-aggregate-table";
import { TrendBadge } from "@/components/trend-badge";
import { Week52RangeBar } from "@/components/week-52-range-bar";
import { computeSectorAggregates, computeSectorPortfolioTotals } from "@/lib/sector-aggregates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AnalysisRow, RunAnalysisResponse, ScoreKey, Signal } from "@/lib/types";

type ColMeta = { thClassName?: string; tdClassName?: string };

function fmtScore(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(4);
}

function fmtPrice(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

function fmtPct(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function fmtCap(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return v.toFixed(0);
}

function isoToUtcDate(iso: string): Date | null {
  const parts = iso.split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function TrendMiniChart({
  dates,
  closes,
  months,
}: {
  dates?: string[];
  closes?: (number | null)[];
  months: number;
}) {
  if (!dates?.length || !closes?.length || dates.length !== closes.length) return <div className="text-muted-foreground">—</div>;

  const pts = dates
    .map((d, i) => ({ d, t: isoToUtcDate(d)?.getTime() ?? null, v: closes[i] }))
    .filter((p) => p.t != null && p.v != null) as { d: string; t: number; v: number }[];
  if (pts.length < 8) return <div className="text-muted-foreground">—</div>;

  const end = pts[pts.length - 1]!;
  const startCutoff = end.t - months * 30 * 24 * 3600 * 1000;
  const win = pts.filter((p) => p.t >= startCutoff);
  if (win.length < 6) return <div className="text-muted-foreground">—</div>;

  // Sparkline scale
  const w = 92;
  const h = 26;
  const pad = 2;
  const minV = Math.min(...win.map((p) => p.v));
  const maxV = Math.max(...win.map((p) => p.v));
  const dv = Math.max(1e-9, maxV - minV);

  const xFor = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, win.length - 1);
  const yFor = (v: number) => pad + (h - pad * 2) * (1 - (v - minV) / dv);
  const line = win.map((p, i) => `${xFor(i).toFixed(1)},${yFor(p.v).toFixed(1)}`).join(" ");

  // Monthly return bars (last X months)
  const byMonth = new Map<string, { t: number; v: number }>();
  for (const p of win) {
    const ym = p.d.slice(0, 7);
    // keep last close in month
    const cur = byMonth.get(ym);
    if (!cur || p.t > cur.t) byMonth.set(ym, { t: p.t, v: p.v });
  }
  const monthsSorted = Array.from(byMonth.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-months);
  const rets: number[] = [];
  for (let i = 1; i < monthsSorted.length; i++) {
    const prev = monthsSorted[i - 1]![1].v;
    const cur = monthsSorted[i]![1].v;
    rets.push(prev ? ((cur - prev) / prev) * 100 : 0);
  }
  const barCount = Math.max(1, rets.length);
  const maxAbs = Math.max(1, ...rets.map((r) => Math.abs(r)));

  return (
    <div className="flex justify-center">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
        {/* Baseline for returns */}
        <line x1="0" y1={h - 1} x2={w} y2={h - 1} stroke="hsl(var(--border))" strokeWidth="0.5" opacity="0.6" />

        {/* Bars (bottom-aligned) */}
        {rets.map((r, i) => {
          const bw = (w - pad * 2) / barCount;
          const bh = Math.max(1, Math.round(((Math.abs(r) / maxAbs) * (h - 8))));
          const x = pad + i * bw;
          const y = h - 1 - bh;
          const fill = r >= 0 ? "rgb(16,185,129)" : "rgb(244,63,94)";
          return <rect key={i} x={x + 0.5} y={y} width={Math.max(1, bw - 1)} height={bh} fill={fill} opacity="0.25" />;
        })}

        {/* Line */}
        <polyline
          points={line}
          fill="none"
          stroke="hsl(var(--foreground))"
          strokeWidth="1.3"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function pctColor(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "";
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-rose-600 dark:text-rose-400";
  return "";
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Calendar Y-M-D only (avoids TZ / SSR–client hydration drift vs local midnight). */
function formatCalendarYmd(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return iso;
  const wd = WEEKDAYS_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}, ${MONTHS_SHORT[m - 1]} ${d}`;
}

function headerForIdx(dateLabels: string[], i: number) {
  const iso = dateLabels[i];
  if (!iso) return `W-${i}`;
  return formatCalendarYmd(iso);
}

function heatmapFromRow(row: AnalysisRow, dateLabels: string[]): { signals: Signal[]; dates: string[] } {
  const y1 = row.signals_1y?.length ? row.signals_1y : row.signals_6m;
  const y1d = row.signals_1y_dates?.length ? row.signals_1y_dates : row.signals_6m_dates;
  if (y1 && y1.length > 0) {
    return { signals: y1, dates: y1d ?? [] };
  }
  const sig = row.signals ?? [];
  const dl = dateLabels ?? [];
  if (sig.length === 0) return { signals: [], dates: [] };
  return {
    signals: [...sig].reverse(),
    dates: [...dl].reverse(),
  };
}

const SCORE_LABELS: Record<ScoreKey, string> = {
  score_1: "Score 1",
  score_2: "Score 2",
  score_3: "Score 3",
};

const ALL = "__all__";
const SIGNAL_OPTIONS = [
  { value: ALL, label: "All Signals" },
  { value: "BUY", label: "BUY" },
  { value: "HOLD", label: "HOLD" },
  { value: "SELL", label: "SELL" },
];

function toCsv(resp: RunAnalysisResponse) {
  const headers = [
    "name", "symbol", "sector", "sub_sector",
    "score_1", "score_2", "score_3",
    "last_price", "last_price_date", "mkt_cap", "52w_low", "52w_high",
    "return_1d", "return_1w", "return_1m", "return_3m", "return_ytd",
    `latest_${headerForIdx(resp.date_labels, 0)}`,
    "1y_weekly_heatmap",
    ...resp.date_labels.slice(1).map((_, i) => `W-${i + 1}_${headerForIdx(resp.date_labels, i + 1)}`),
  ];
  const lines = [headers.join(",")];
  for (const r of resp.rows) {
    const row = [
      JSON.stringify(r.name ?? ""),
      JSON.stringify(r.symbol),
      JSON.stringify(r.sector ?? ""),
      JSON.stringify(r.sub_sector ?? ""),
      r.score_1 ?? "", r.score_2 ?? "", r.score_3 ?? "",
      r.last_price ?? "", r.last_price_date ?? "", r.mkt_cap ?? "", r.low_52w ?? "", r.high_52w ?? "",
      r.return_1d ?? "", r.return_1w ?? "", r.return_1m ?? "", r.return_3m ?? "", r.return_ytd ?? "",
      r.signals[0] ?? "",
      (
        r.signals_1y?.length
          ? r.signals_1y
          : r.signals_6m?.length
            ? r.signals_6m
            : [...(r.signals ?? [])].reverse()
      ).join("|"),
      ...r.signals.slice(1),
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AnalysisTable({
  data,
  onRowClick,
  sectors = [],
  subSectors = [],
  sectorFilter,
  subSectorFilter,
  onSectorChange,
  onSubSectorChange,
  signalFilter,
  onSignalChange,
  allValue = "__all__",
}: {
  data: RunAnalysisResponse;
  onRowClick: (row: AnalysisRow) => void;
  sectors?: string[];
  subSectors?: string[];
  sectorFilter?: string;
  subSectorFilter?: string;
  onSectorChange?: (v: string) => void;
  onSubSectorChange?: (v: string) => void;
  signalFilter?: string;
  onSignalChange?: (v: string) => void;
  allValue?: string;
}) {
  const selectedScore = data.metadata.selected_score as ScoreKey;

  const defaultSorting = React.useMemo<SortingState>(() => {
    // For global indices we want a stable continent-wise layout by default.
    if (data.metadata.index_name === "global_indices") {
      return [{ id: "sector", desc: false }];
    }
    return [{ id: selectedScore, desc: true }];
  }, [data.metadata.index_name, selectedScore]);

  const [sorting, setSorting] = React.useState<SortingState>(() => defaultSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [tableView, setTableView] = React.useState<"stocks" | "sectors" | "weekly_totals">("stocks");
  const [trendMonths, setTrendMonths] = React.useState<number>(6);

  React.useEffect(() => {
    setSorting(defaultSorting);
  }, [defaultSorting]);

  const columns = React.useMemo<ColumnDef<AnalysisRow>[]>(() => {
    const badgeSm = "px-1.5 py-0 text-[10px] leading-tight h-5 font-semibold";
    const eodIso = data.rows.find((r) => r.last_price_date)?.last_price_date ?? null;
    const lastPriceSubheader = eodIso ? formatCalendarYmd(eodIso) : "—";
    const isGlobalIndices = data.metadata.index_name === "global_indices";
    const continentRank = (v?: string | null) => {
      const s = (v || "").trim();
      if (s === "Americas") return 0;
      if (s === "EMEA") return 1;
      if (s === "Asia/Pacific") return 2;
      if (s === "Global") return 3;
      return 99;
    };
    const uniRank = (r: AnalysisRow) =>
      r.universe_rank === null || r.universe_rank === undefined ? 10 ** 9 : r.universe_rank;

    const latestCol: ColumnDef<AnalysisRow> = {
      id: "sig_0",
      header: () => (
        <div className="whitespace-nowrap text-[11px] leading-snug text-center">
          <div className="font-semibold text-foreground">Latest</div>
          <div className="text-muted-foreground font-normal">{headerForIdx(data.date_labels, 0)}</div>
        </div>
      ),
      cell: ({ row }) => {
        const sig = row.original.signals[0] as Signal | undefined;
        return sig ? <TrendBadge signal={sig} className={badgeSm} /> : <TrendBadge signal="N/A" className={badgeSm} />;
      },
    };

    const heatmapCol: ColumnDef<AnalysisRow> = {
      id: "sig_1y",
      meta: {
        thClassName: "sticky right-0 z-20 bg-card shadow-[-1px_0_0_0_hsl(var(--border))]",
        tdClassName: "sticky right-0 z-10 bg-card shadow-[-1px_0_0_0_hsl(var(--border))]",
      } satisfies ColMeta,
      header: () => (
        <div className="whitespace-nowrap text-[11px] leading-snug text-center min-w-[6rem]">
          <div className="font-semibold text-foreground">1Y</div>
          <div className="text-muted-foreground font-normal">heatmap</div>
        </div>
      ),
      cell: ({ row }) => {
        const { signals: hs, dates: hd } = heatmapFromRow(row.original, data.date_labels);
        return (
          <div className="flex justify-center">
            <DashboardSignalHeatmap signals={hs} dates={hd} />
          </div>
        );
      },
    };

    const tailSignalCols: ColumnDef<AnalysisRow>[] = data.date_labels.slice(1).map((_, j) => {
      const i = j + 1;
      return {
        id: `sig_${i}`,
        header: () => (
          <div className="whitespace-nowrap text-[11px] leading-snug text-center">
            <div className="font-semibold text-foreground">{`W-${i}`}</div>
            <div className="text-muted-foreground font-normal">{headerForIdx(data.date_labels, i)}</div>
          </div>
        ),
        cell: ({ row }) => {
          const sig = row.original.signals[i] as Signal | undefined;
          return sig ? <TrendBadge signal={sig} className={badgeSm} /> : <TrendBadge signal="N/A" className={badgeSm} />;
        },
      };
    });

    const signalCols = [latestCol, heatmapCol, ...tailSignalCols];

    return [
      {
        accessorKey: "name",
        header: "Stock Name",
        cell: ({ row }) => (
          <div
            className="max-w-[6.5rem] sm:max-w-[7.25rem] truncate text-[13px] font-medium leading-snug"
            title={row.original.name ?? ""}
          >
            {row.original.name ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => (
          <div className="font-mono text-xs font-semibold">{row.original.symbol}</div>
        ),
      },
      {
        accessorKey: "last_price",
        header: () => (
          <div className="whitespace-nowrap text-[11px] leading-snug text-right">
            <div className="font-semibold text-foreground">Last Price</div>
            <div className="font-normal text-muted-foreground" title={eodIso ? `EOD as of ${eodIso}` : undefined}>
              {lastPriceSubheader}
            </div>
          </div>
        ),
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className="tabular-nums text-xs font-semibold text-right">{fmtPrice(row.original.last_price)}</div>
        ),
      },
      {
        accessorKey: "mkt_cap",
        header: () => <div className="text-right whitespace-nowrap">Mkt Cap</div>,
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className="tabular-nums text-xs text-right">{fmtCap(row.original.mkt_cap)}</div>
        ),
      },
      {
        id: "trend",
        header: () => (
          <div className="whitespace-nowrap text-[11px] leading-snug text-center min-w-[6.5rem]">
            <div className="font-semibold text-foreground">Trend</div>
            <div className="text-muted-foreground font-normal">{trendMonths}M</div>
          </div>
        ),
        cell: ({ row }) => (
          <TrendMiniChart
            dates={row.original.trend_1y_dates}
            closes={row.original.trend_1y_closes}
            months={trendMonths}
          />
        ),
      },
      {
        accessorKey: "sector",
        header: "Sector",
        sortingFn: isGlobalIndices
          ? (a, b) => {
              const ca = continentRank(a.original.sector);
              const cb = continentRank(b.original.sector);
              if (ca !== cb) return ca - cb;
              return uniRank(a.original) - uniRank(b.original);
            }
          : "alphanumeric",
        cell: ({ row }) => (
          <div className="max-w-[88px] truncate text-xs text-muted-foreground" title={row.original.sector ?? ""}>
            {row.original.sector ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "sub_sector",
        header: "Sub-sector",
        cell: ({ row }) => (
          <div
            className="max-w-[4.5rem] sm:max-w-[5.25rem] truncate text-xs text-muted-foreground"
            title={row.original.sub_sector ?? ""}
          >
            {row.original.sub_sector ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: selectedScore,
        header: SCORE_LABELS[selectedScore],
        cell: ({ row }) => (
          <div className="tabular-nums text-xs text-right">{fmtScore(row.original[selectedScore])}</div>
        ),
      },
      {
        id: "range_52w",
        accessorFn: (row) => {
          const l = row.low_52w;
          const h = row.high_52w;
          const p = row.last_price;
          if (l == null || h == null || p == null || h <= l) return null;
          return (p - l) / (h - l);
        },
        sortingFn: "basic",
        header: () => (
          <div className="whitespace-nowrap text-[11px] leading-snug text-center min-w-[6.5rem]">
            <div className="font-semibold text-foreground">52W</div>
            <div className="text-muted-foreground font-normal">range</div>
          </div>
        ),
        cell: ({ row }) => (
          <Week52RangeBar
            low={row.original.low_52w}
            high={row.original.high_52w}
            last={row.original.last_price}
          />
        ),
      },
      {
        accessorKey: "return_1d",
        header: "1D %",
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className={cn("tabular-nums text-xs font-medium", pctColor(row.original.return_1d))}>
            {fmtPct(row.original.return_1d)}
          </div>
        ),
      },
      {
        accessorKey: "return_1w",
        header: "1W %",
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className={cn("tabular-nums text-xs font-medium", pctColor(row.original.return_1w))}>
            {fmtPct(row.original.return_1w)}
          </div>
        ),
      },
      {
        accessorKey: "return_1m",
        header: "1M %",
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className={cn("tabular-nums text-xs font-medium", pctColor(row.original.return_1m))}>
            {fmtPct(row.original.return_1m)}
          </div>
        ),
      },
      {
        accessorKey: "return_3m",
        header: "3M %",
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className={cn("tabular-nums text-xs font-medium", pctColor(row.original.return_3m))}>
            {fmtPct(row.original.return_3m)}
          </div>
        ),
      },
      {
        accessorKey: "return_ytd",
        header: "YTD %",
        sortingFn: "basic",
        cell: ({ row }) => (
          <div className={cn("tabular-nums text-xs font-medium", pctColor(row.original.return_ytd))}>
            {fmtPct(row.original.return_ytd)}
          </div>
        ),
      },
      ...signalCols,
    ];
  }, [data.date_labels, data.rows, selectedScore, trendMonths]);

  const table = useReactTable({
    data: data.rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue || "").toLowerCase().trim();
      if (!q) return true;
      const name = String(row.original.name || "").toLowerCase();
      const sym = String(row.original.symbol || "").toLowerCase();
      return name.includes(q) || sym.includes(q);
    },
  });

  const hasActiveFilter =
    (sectorFilter && sectorFilter !== allValue) ||
    (subSectorFilter && subSectorFilter !== allValue) ||
    (signalFilter && signalFilter !== allValue);

  const sectorAggregates = React.useMemo(
    () => computeSectorAggregates(data.rows),
    [data.rows]
  );
  const sectorPortfolioTotals = React.useMemo(
    () => computeSectorPortfolioTotals(data.rows),
    [data.rows]
  );

  const weeklyTotals = React.useMemo(() => {
    // Prefer the dedicated 1Y weekly series (Fri weeks) when present.
    const firstWithDates = data.rows.find((r) => (r.signals_1y_dates?.length ?? 0) >= 8);
    const baseDates = firstWithDates?.signals_1y_dates ?? [];
    const weeks = baseDates.slice(-8);
    if (weeks.length === 0) return [];

    const totals = weeks.map((iso) => ({ iso, BUY: 0, HOLD: 0, SELL: 0, NA: 0 }));
    const idxByIso = new Map(weeks.map((d, i) => [d, i] as const));

    for (const r of data.rows) {
      const { signals: hs, dates: hd } = heatmapFromRow(r, data.date_labels);
      if (!hd.length || !hs.length) continue;
      const m = new Map<string, Signal>();
      for (let i = 0; i < Math.min(hd.length, hs.length); i++) {
        m.set(hd[i]!, hs[i]!);
      }
      for (const iso of weeks) {
        const i = idxByIso.get(iso);
        if (i == null) continue;
        const sig = m.get(iso) ?? "N/A";
        if (sig === "BUY") totals[i]!.BUY += 1;
        else if (sig === "SELL") totals[i]!.SELL += 1;
        else if (sig === "HOLD") totals[i]!.HOLD += 1;
        else totals[i]!.NA += 1;
      }
    }

    // Most-recent week first
    return [...totals].reverse();
  }, [data.date_labels, data.rows]);

  return (
    <div className="rounded-xl border bg-card shadow-sm">
      <div
        className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto p-3 [scrollbar-width:thin]"
        role="toolbar"
        aria-label="Table filters and export"
      >
        <Input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search symbol or name…"
          className="h-8 w-[200px] shrink-0 text-xs"
        />
        {sectors.length > 0 && onSectorChange && (
          <div className="w-[152px] shrink-0">
            <Select value={sectorFilter ?? allValue} onValueChange={onSectorChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Sectors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allValue}>All Sectors</SelectItem>
                {sectors.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {subSectors.length > 0 && onSubSectorChange && (
          <div className="w-[168px] shrink-0">
            <Select value={subSectorFilter ?? allValue} onValueChange={onSubSectorChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Sub-sectors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allValue}>All Sub-sectors</SelectItem>
                {subSectors.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {onSignalChange && (
          <div className="w-[136px] shrink-0">
            <Select value={signalFilter ?? allValue} onValueChange={onSignalChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="All Signals" />
              </SelectTrigger>
              <SelectContent>
                {SIGNAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="w-[110px] shrink-0">
          <Select value={String(trendMonths)} onValueChange={(v) => setTrendMonths(Number(v))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Trend months" />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 6, 9, 12].map((m) => (
                <SelectItem key={m} value={String(m)}>{`Trend ${m}M`}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasActiveFilter && onSectorChange && onSubSectorChange && onSignalChange && (
          <Button
            variant="ghost"
            className="h-8 shrink-0 px-2 text-xs"
            onClick={() => { onSectorChange(allValue); onSubSectorChange(allValue); onSignalChange(allValue); }}
          >
            Clear
          </Button>
        )}
        <Button
          variant="outline"
          className="h-8 shrink-0 px-3 text-xs"
          onClick={() => {
            const csv = toCsv(data);
            download(`analysis-${data.metadata.index_name}.csv`, csv);
          }}
        >
          Export CSV
        </Button>
        <div
          className="ml-1 flex shrink-0 items-center rounded-md border border-border bg-muted/40 p-0.5"
          role="tablist"
          aria-label="Table view"
        >
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-7 shrink-0 rounded-sm px-2.5 text-xs",
              tableView === "stocks" && "bg-background text-foreground shadow-sm"
            )}
            onClick={() => setTableView("stocks")}
            role="tab"
            aria-selected={tableView === "stocks"}
          >
            Stock based
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-7 shrink-0 rounded-sm px-2.5 text-xs",
              tableView === "sectors" && "bg-background text-foreground shadow-sm"
            )}
            onClick={() => setTableView("sectors")}
            role="tab"
            aria-selected={tableView === "sectors"}
          >
            Sector based
          </Button>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-7 shrink-0 rounded-sm px-2.5 text-xs",
              tableView === "weekly_totals" && "bg-background text-foreground shadow-sm"
            )}
            onClick={() => setTableView("weekly_totals")}
            role="tab"
            aria-selected={tableView === "weekly_totals"}
          >
            8W totals
          </Button>
        </div>
        <span className="ml-auto shrink-0 whitespace-nowrap pl-2 text-xs font-medium text-muted-foreground tabular-nums">
          {tableView === "stocks" ? (
            <>
              Showing {table.getRowModel().rows.length} of {data.rows.length}
            </>
          ) : tableView === "sectors" ? (
            <>
              {sectorAggregates.length} sectors · {sectorPortfolioTotals.stockCount} stocks
            </>
          ) : (
            <>
              8 weeks · {data.rows.length} stocks
            </>
          )}
        </span>
      </div>

      {tableView === "sectors" ? (
        <SectorAggregateTable aggregates={sectorAggregates} totals={sectorPortfolioTotals} />
      ) : null}

      {tableView === "weekly_totals" ? (
        <div className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Weekly totals (Fri close) — last 8 weeks
          </div>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
                <tr className="border-b border-border/80">
                  <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                    Week ending
                  </th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">
                    BUY
                  </th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">
                    HOLD
                  </th>
                  <th className="px-2 py-2 text-right text-xs font-semibold text-muted-foreground whitespace-nowrap">
                    SELL
                  </th>
                </tr>
              </thead>
              <tbody>
                {weeklyTotals.map((w) => (
                  <tr key={w.iso} className="border-b hover:bg-muted/40 transition-colors">
                    <td className="px-2 py-2 tabular-nums text-muted-foreground">
                      {formatCalendarYmd(w.iso)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {w.BUY}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-amber-600 dark:text-amber-300">
                      {w.HOLD}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                      {w.SELL}
                    </td>
                  </tr>
                ))}
                {weeklyTotals.length === 0 ? (
                  <tr>
                    <td className="px-2 py-6 text-sm text-muted-foreground" colSpan={4}>
                      No weekly signal history found yet. Run analysis on an equity index to populate 1Y weekly heatmap.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tableView === "stocks" ? (
      <div className="max-h-[min(68vh,720px)] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border/80">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={cn(
                      "px-2 py-2 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap",
                      ((h.column.columnDef.meta as ColMeta | undefined)?.thClassName ?? ""),
                      h.column.getCanSort() ? "cursor-pointer select-none hover:text-foreground" : ""
                    )}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => {
              const today = r.original.signals[0];
              const tint =
                today === "BUY"
                  ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                  : today === "SELL"
                    ? "bg-rose-500/5 hover:bg-rose-500/10"
                    : "hover:bg-muted/40";
              return (
                <tr
                  key={r.id}
                  className={cn("border-b transition-colors", tint)}
                  onClick={() => onRowClick(r.original)}
                  role="button"
                >
                  {r.getVisibleCells().map((c) => (
                    <td
                      key={c.id}
                      className={cn(
                        "px-2 py-1.5 align-middle",
                        ((c.column.columnDef.meta as ColMeta | undefined)?.tdClassName ?? "")
                      )}
                    >
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3">
        {tableView === "stocks" ? (
          <>
            <div className="text-xs font-medium text-muted-foreground">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          </>
        ) : (
          <div className="text-xs font-medium text-muted-foreground">
            Averages use only rows with non-null returns; Σ mkt cap sums reported market caps in this set.
          </div>
        )}
      </div>
    </div>
  );
}
