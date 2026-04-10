"use client";

import { cn } from "@/lib/utils";
import {
  signalCell,
  type SectorAggregateRow,
  type SectorPortfolioTotals,
} from "@/lib/sector-aggregates";

function fmtCapSum(v: number) {
  if (v <= 0) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  return v.toFixed(0);
}

function fmtAvgPct(v: number | null) {
  if (v === null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function pctColor(v: number | null) {
  if (v === null || Number.isNaN(v)) return "";
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-rose-600 dark:text-rose-400";
  return "";
}

export function SectorAggregateTable({
  aggregates,
  totals,
}: {
  aggregates: SectorAggregateRow[];
  totals: SectorPortfolioTotals;
}) {
  const data = aggregates;

  return (
    <div className="max-h-[min(68vh,720px)] overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
          <tr className="border-b border-border/80">
            <th
              rowSpan={2}
              className="border-b border-border/60 px-2 py-2 text-left align-middle text-xs font-semibold text-muted-foreground"
            >
              Sector
            </th>
            <th
              rowSpan={2}
              className="border-b border-border/60 px-2 py-2 text-right align-middle text-xs font-semibold text-muted-foreground whitespace-nowrap"
            >
              # stocks
            </th>
            <th
              rowSpan={2}
              className="border-b border-border/60 px-2 py-2 text-right align-middle text-xs font-semibold text-muted-foreground whitespace-nowrap"
            >
              Σ mkt cap
            </th>
            <th
              colSpan={5}
              className="border-b border-border/60 px-2 py-1.5 text-center text-xs font-semibold text-muted-foreground"
            >
              Avg of ind stock rt
            </th>
            <th
              rowSpan={2}
              className="border-b border-border/60 px-2 py-2 text-right align-middle text-xs font-semibold text-emerald-700 dark:text-emerald-400 whitespace-nowrap"
            >
              Buy
            </th>
            <th
              rowSpan={2}
              className="border-b border-border/60 px-2 py-2 text-right align-middle text-xs font-semibold text-amber-700 dark:text-amber-400 whitespace-nowrap"
            >
              Hold
            </th>
            <th
              rowSpan={2}
              className="border-b border-border/60 px-2 py-2 text-right align-middle text-xs font-semibold text-rose-700 dark:text-rose-400 whitespace-nowrap"
            >
              Sell
            </th>
          </tr>
          <tr className="border-b border-border/80 bg-card">
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold text-muted-foreground">1D</th>
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold text-muted-foreground">1W</th>
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold text-muted-foreground">1M</th>
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold text-muted-foreground">3M</th>
            <th className="px-2 py-1.5 text-right text-[11px] font-semibold text-muted-foreground">YTD</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={11} className="px-4 py-8 text-center text-muted-foreground">
                No sector data in the current result set.
              </td>
            </tr>
          ) : (
            data.map((r) => <SectorRow key={r.sector} r={r} />)
          )}
        </tbody>
        {data.length > 0 ? (
          <tfoot className="sticky bottom-0 z-[1] bg-card shadow-[0_-1px_0_0_hsl(var(--border))]">
            <TotalFooterRow totals={totals} />
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function TotalFooterRow({ totals: t }: { totals: SectorPortfolioTotals }) {
  const n = t.stockCount;
  return (
    <tr className="border-t-2 border-border bg-muted/50 font-semibold text-foreground dark:bg-muted/35">
      <td className="px-2 py-2 text-left">Total (all rows)</td>
      <td className="px-2 py-2 text-right tabular-nums">{n}</td>
      <td className="px-2 py-2 text-right tabular-nums">{fmtCapSum(t.sumMktCap)}</td>
      <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(t.avgReturn1d))}>
        {fmtAvgPct(t.avgReturn1d)}
      </td>
      <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(t.avgReturn1w))}>
        {fmtAvgPct(t.avgReturn1w)}
      </td>
      <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(t.avgReturn1m))}>
        {fmtAvgPct(t.avgReturn1m)}
      </td>
      <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(t.avgReturn3m))}>
        {fmtAvgPct(t.avgReturn3m)}
      </td>
      <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(t.avgReturnYtd))}>
        {fmtAvgPct(t.avgReturnYtd)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
        {signalCell(t.buyCount, n)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">
        {signalCell(t.holdCount, n)}
      </td>
      <td className="px-2 py-2 text-right tabular-nums text-rose-700 dark:text-rose-400">
        {signalCell(t.sellCount, n)}
      </td>
    </tr>
  );
}

function SectorRow({ r }: { r: SectorAggregateRow }) {
  return (
    <tr className="border-b border-border/40 hover:bg-muted/30">
      <td className="max-w-[10rem] truncate px-2 py-1.5 font-medium text-foreground" title={r.sector}>
        {r.sector}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{r.stockCount}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{fmtCapSum(r.sumMktCap)}</td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", pctColor(r.avgReturn1d))}>
        {fmtAvgPct(r.avgReturn1d)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", pctColor(r.avgReturn1w))}>
        {fmtAvgPct(r.avgReturn1w)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", pctColor(r.avgReturn1m))}>
        {fmtAvgPct(r.avgReturn1m)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", pctColor(r.avgReturn3m))}>
        {fmtAvgPct(r.avgReturn3m)}
      </td>
      <td className={cn("px-2 py-1.5 text-right tabular-nums font-medium", pctColor(r.avgReturnYtd))}>
        {fmtAvgPct(r.avgReturnYtd)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
        {signalCell(r.buyCount, r.stockCount)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-amber-700 dark:text-amber-400">
        {signalCell(r.holdCount, r.stockCount)}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
        {signalCell(r.sellCount, r.stockCount)}
      </td>
    </tr>
  );
}
