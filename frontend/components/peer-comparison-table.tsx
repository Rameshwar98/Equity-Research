"use client";

import { DashboardSignalHeatmap } from "@/components/dashboard-signal-heatmap";
import { TrendBadge } from "@/components/trend-badge";
import { cn } from "@/lib/utils";
import type { PeerRow, Signal } from "@/lib/types";

function fmtCap(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return `${(v / 1e3).toFixed(0)}K`;
}

function fmtPct(v?: number | null, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function fmtScore(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const abs = Math.abs(v);
  if (abs >= 100) return v.toFixed(1);
  if (abs >= 10) return v.toFixed(2);
  return v.toFixed(3);
}

/** Return cells: solid-enough tints + dark text (light) / light text (dark) for WCAG-friendly contrast. */
function retHeat(v?: number | null) {
  if (v == null || Number.isNaN(v)) {
    return "bg-muted/80 text-foreground/80 dark:bg-muted/50 dark:text-muted-foreground";
  }
  if (v >= 3) {
    return "bg-emerald-200 text-emerald-950 font-semibold dark:bg-emerald-950/55 dark:text-emerald-50";
  }
  if (v >= 0.5) {
    return "bg-emerald-100 text-emerald-950 dark:bg-emerald-950/40 dark:text-emerald-100";
  }
  if (v >= -0.5) {
    return "bg-amber-100 text-amber-950 dark:bg-amber-950/35 dark:text-amber-100";
  }
  if (v >= -3) {
    return "bg-orange-100 text-orange-950 dark:bg-orange-950/40 dark:text-orange-100";
  }
  return "bg-rose-200 text-rose-950 font-semibold dark:bg-rose-950/55 dark:text-rose-50";
}

export function PeerComparisonTable({
  sector,
  peerSource,
  peers,
  loading,
  error,
}: {
  sector?: string | null;
  peerSource?: string | null;
  peers: PeerRow[];
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        Loading peer comparison…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!peers.length) {
    return (
      <div className="rounded-lg border bg-muted/20 px-4 py-5 text-center text-sm text-muted-foreground">
        No sector peers found for this index.
      </div>
    );
  }

  const cols = [
    { key: "name", label: "Name" },
    { key: "mkt", label: "Mkt cap" },
    { key: "sig", label: "Signal" },
    { key: "score", label: "Score" },
    { key: "1d", label: "1D" },
    { key: "1w", label: "1W" },
    { key: "1m", label: "1M" },
    { key: "3m", label: "3M" },
    { key: "ytd", label: "YTD" },
    { key: "hm", label: "1Y" },
  ] as const;

  return (
    <div className="rounded-lg border border-border/80 overflow-hidden shadow-sm bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/80 bg-muted/60 px-3 py-2.5 text-sm text-foreground">
        {peerSource === "fmp" ? (
          <span className="font-semibold">Peers · FMP</span>
        ) : peerSource === "sector" ? (
          <span className="font-semibold">Peers · sector</span>
        ) : null}
        {sector ? (
          <span className="text-muted-foreground truncate" title={sector}>
            <span className="font-medium text-foreground/90">Sector:</span> {sector}
          </span>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-[11px] leading-tight">
          <colgroup>
            <col className="w-[6.75rem]" />
            <col className="w-[2.85rem]" />
            <col className="w-[2.65rem]" />
            <col className="w-[3.1rem]" />
            <col className="w-[2.5rem]" />
            <col className="w-[2.5rem]" />
            <col className="w-[2.5rem]" />
            <col className="w-[2.5rem]" />
            <col className="w-[2.5rem]" />
            <col className="w-[6.5rem]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border/80 bg-muted/70 dark:bg-muted/40">
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-1 py-1.5 font-semibold text-left whitespace-nowrap text-foreground",
                    c.key !== "name" && c.key !== "sig" && "text-center",
                    c.key === "hm" && "text-center"
                  )}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {peers.map((p) => (
              <tr
                key={p.symbol}
                className={cn(
                  "border-b border-border/70 last:border-0 bg-card hover:bg-muted/30 transition-colors",
                  p.is_subject && "bg-primary/10 ring-1 ring-inset ring-primary/25"
                )}
              >
                <td className="px-1 py-1 align-top">
                  <div
                    className="truncate font-semibold text-foreground leading-tight"
                    title={p.name ?? p.symbol}
                  >
                    {p.name ?? p.symbol}
                  </div>
                  <div className="mt-0.5 font-mono text-[10px] font-semibold text-foreground/75 dark:text-foreground/80 tracking-tight">
                    {p.symbol}
                  </div>
                </td>
                <td className="px-1 py-1 tabular-nums text-right font-medium text-foreground align-middle">
                  {fmtCap(p.mkt_cap)}
                </td>
                <td className="px-0.5 py-1 text-center align-middle">
                  <TrendBadge
                    signal={p.signal as Signal}
                    className="h-5 px-1 py-0 text-[9px] leading-none font-semibold"
                  />
                </td>
                <td className="px-1 py-1 text-right tabular-nums font-semibold text-foreground align-middle">
                  {fmtScore(p.score)}
                </td>
                <td className={cn("px-0.5 py-1 text-center tabular-nums", retHeat(p.return_1d))}>
                  {fmtPct(p.return_1d, 1)}
                </td>
                <td className={cn("px-0.5 py-1 text-center tabular-nums", retHeat(p.return_1w))}>
                  {fmtPct(p.return_1w, 1)}
                </td>
                <td className={cn("px-0.5 py-1 text-center tabular-nums", retHeat(p.return_1m))}>
                  {fmtPct(p.return_1m, 1)}
                </td>
                <td className={cn("px-0.5 py-1 text-center tabular-nums", retHeat(p.return_3m))}>
                  {fmtPct(p.return_3m, 1)}
                </td>
                <td className={cn("px-0.5 py-1 text-center tabular-nums", retHeat(p.return_ytd))}>
                  {fmtPct(p.return_ytd, 1)}
                </td>
                <td className="px-1 py-1 align-middle">
                  <div className="flex justify-center">
                    <DashboardSignalHeatmap
                      variant="compact"
                      signals={(p.signals_1y ?? []) as Signal[]}
                      dates={p.signals_1y_dates ?? []}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
