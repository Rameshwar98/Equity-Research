import type { QuarterlyFinancials } from "@/lib/types";

export type FundamentalsView = "q4" | "q8" | "y3";

/** Keep the last `lastN` periods (columns are oldest → newest; we show the most recent `lastN`). */
export function sliceFinancialColumns(
  data: QuarterlyFinancials,
  lastN: number
): QuarterlyFinancials {
  const n = data.columns.length;
  if (n <= lastN) return data;
  const start = n - lastN;
  return {
    columns: data.columns.slice(start),
    period_end_dates: data.period_end_dates.slice(start),
    rows: data.rows.map((r) =>
      r.spacer ? r : { ...r, values: r.values.slice(start) }
    ),
  };
}
