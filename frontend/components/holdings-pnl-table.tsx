"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import type { HoldingsPnlRow } from "@/lib/types";
import { cn } from "@/lib/utils";

function fmtMoney(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

function fmtPct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function pctColor(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "";
  if (v > 0) return "text-emerald-600 dark:text-emerald-400";
  if (v < 0) return "text-rose-600 dark:text-rose-400";
  return "";
}

export function HoldingsPnlTable({ rows }: { rows: HoldingsPnlRow[] }) {
  const sorted = React.useMemo(() => {
    const r = [...(rows || [])];
    r.sort((a, b) => {
      const ap = a.pnl_pct;
      const bp = b.pnl_pct;
      if (ap == null && bp == null) return 0;
      if (ap == null) return 1;
      if (bp == null) return -1;
      return bp - ap;
    });
    return r;
  }, [rows]);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-3">
        <div className="text-sm font-semibold text-foreground">Holdings P&amp;L</div>
        <div className="mt-2 overflow-auto">
          <table className="w-full min-w-[860px] border-collapse text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <th className="px-2 py-2 text-left font-medium">Symbol</th>
                <th className="px-2 py-2 text-left font-medium">Name</th>
                <th className="px-2 py-2 text-left font-medium">Sector</th>
                <th className="px-2 py-2 text-right font-medium">Entry</th>
                <th className="px-2 py-2 text-left font-medium">Entry date</th>
                <th className="px-2 py-2 text-right font-medium">Current</th>
                <th className="px-2 py-2 text-right font-medium">% P&amp;L</th>
                <th className="px-2 py-2 text-right font-medium">Abs</th>
                <th className="px-2 py-2 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {!sorted.length ? (
                <tr className="border-b border-border">
                  <td className="px-2 py-4 text-muted-foreground" colSpan={9}>
                    No P&amp;L data yet.
                  </td>
                </tr>
              ) : (
                sorted.map((r) => (
                  <tr key={r.symbol} className="border-b border-border hover:bg-muted/30">
                    <td className="px-2 py-2 font-semibold text-foreground">{r.symbol}</td>
                    <td className="px-2 py-2 max-w-[260px] truncate" title={r.name || ""}>
                      {r.name || "—"}
                    </td>
                    <td className="px-2 py-2">{r.sector || "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.entry_price)}</td>
                    <td className="px-2 py-2">{r.entry_date}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.current_price)}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums font-medium", pctColor(r.pnl_pct))}>
                      {fmtPct(r.pnl_pct)}
                    </td>
                    <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(r.pnl_pct))}>
                      {fmtMoney(r.pnl_abs)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.days_held ?? 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Abs P&amp;L is per-share \(current - entry\) under equal-weight tracking.
        </div>
      </CardContent>
    </Card>
  );
}

