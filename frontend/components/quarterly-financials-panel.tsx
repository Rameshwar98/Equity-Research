"use client";

import type { QuarterlyFinancials } from "@/lib/types";
import { cn } from "@/lib/utils";

function fmtCell(n: number | null | undefined, format: QuarterlyFinancials["rows"][0]["format"]): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (format === "percent") return `${n.toFixed(1)}%`;
  if (format === "ratio") return n.toFixed(2);
  if (format === "per_share") return n.toFixed(2);
  if (format === "price") return n.toFixed(2);
  const v = n;
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function QuarterlyFinancialsPanel({
  symbol,
  data,
}: {
  symbol: string;
  data: QuarterlyFinancials;
}) {
  const { columns, period_end_dates, rows } = data;
  if (!columns.length || !rows.length) {
    return (
      <p className="text-sm text-muted-foreground leading-relaxed">No quarterly fundamentals returned for this symbol.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border shadow-sm">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-3 py-2.5 text-left font-semibold text-foreground">{symbol}</th>
            {columns.map((c, i) => (
              <th key={i} className="px-3 py-2.5 text-right font-semibold text-foreground tabular-nums">
                <div>{c}</div>
                {period_end_dates[i] ? (
                  <div className="mt-1 text-xs font-normal text-muted-foreground">{period_end_dates[i]}</div>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) =>
            row.spacer ? (
              <tr key={`spacer-${ri}`} className="bg-border/40">
                <td colSpan={columns.length + 1} className="h-1.5 p-0" />
              </tr>
            ) : (
              <tr
                key={`${row.label}-${ri}`}
                className={cn(
                  "border-b border-border/70 last:border-0",
                  ri === 0 ? "bg-muted/25" : "bg-card"
                )}
              >
                <td
                  className={cn(
                    "px-3 py-2 font-medium text-foreground leading-snug",
                    ri === 0 ? "bg-muted/30" : "bg-muted/15"
                  )}
                >
                  {row.label}
                </td>
                {columns.map((_, ci) => (
                  <td
                    key={ci}
                    className="px-3 py-2 text-right font-mono text-[13px] tabular-nums text-foreground"
                  >
                    {fmtCell(row.values[ci], row.format)}
                  </td>
                ))}
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
