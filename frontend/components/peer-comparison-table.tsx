"use client";

import type { PeerRow, Signal } from "@/lib/types";
import { TrendBadge } from "@/components/trend-badge";
import { cn } from "@/lib/utils";

function fmtCap(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  if (v >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  return `${(v / 1e3).toFixed(0)}K`;
}

function fmtPct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}%`;
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

function fmtAnnounce(iso?: string | null) {
  if (!iso) return "—";
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  const [y, m, d] = p.map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
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
    { key: "1d", label: "1D" },
    { key: "1w", label: "1W" },
    { key: "1m", label: "1M" },
    { key: "3m", label: "3M" },
    { key: "ytd", label: "YTD" },
    { key: "ann", label: "Latest news" },
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
        <table className="w-full min-w-[720px] text-sm border-collapse">
          <thead>
            <tr className="border-b border-border/80 bg-muted/70 dark:bg-muted/40">
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "px-2.5 py-2.5 font-semibold text-left whitespace-nowrap text-foreground",
                    c.key !== "name" && c.key !== "sig" && "text-center",
                    (c.key === "1d" || c.key === "1w" || c.key === "1m" || c.key === "3m" || c.key === "ytd") &&
                      "min-w-[4.75rem]"
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
                <td className="px-2.5 py-2 max-w-[200px] align-top">
                  <div className="truncate font-semibold text-foreground leading-snug" title={p.name ?? p.symbol}>
                    {p.name ?? p.symbol}
                  </div>
                  <div className="font-mono text-xs font-semibold text-foreground/75 dark:text-foreground/80 mt-1 tracking-tight">
                    {p.symbol}
                  </div>
                </td>
                <td className="px-2.5 py-2 tabular-nums text-right font-medium text-foreground align-middle">
                  {fmtCap(p.mkt_cap)}
                </td>
                <td className="px-2.5 py-2 text-center align-middle">
                  <TrendBadge signal={p.signal as Signal} />
                </td>
                <td className={cn("px-1.5 py-2 text-center tabular-nums text-sm min-w-[4.75rem]", retHeat(p.return_1d))}>
                  {fmtPct(p.return_1d)}
                </td>
                <td className={cn("px-1.5 py-2 text-center tabular-nums text-sm min-w-[4.75rem]", retHeat(p.return_1w))}>
                  {fmtPct(p.return_1w)}
                </td>
                <td className={cn("px-1.5 py-2 text-center tabular-nums text-sm min-w-[4.75rem]", retHeat(p.return_1m))}>
                  {fmtPct(p.return_1m)}
                </td>
                <td className={cn("px-1.5 py-2 text-center tabular-nums text-sm min-w-[4.75rem]", retHeat(p.return_3m))}>
                  {fmtPct(p.return_3m)}
                </td>
                <td className={cn("px-1.5 py-2 text-center tabular-nums text-sm min-w-[4.75rem]", retHeat(p.return_ytd))}>
                  {fmtPct(p.return_ytd)}
                </td>
                <td className="px-2.5 py-2 tabular-nums text-center whitespace-nowrap text-foreground/85 text-sm min-w-[5.5rem]">
                  {fmtAnnounce(p.announcement_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
