import { cn } from "@/lib/utils";
import type { StockDetailsResponse } from "@/lib/types";

function fmt(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

type Row = { label: string; value: number | null | undefined; highlight?: string; isPrice?: boolean };

export function FibPanel({ data }: { data: StockDetailsResponse }) {
  const fibLevels: Row[] = [
    { label: "52W High", value: data.fib.high_52week, highlight: "text-emerald-600 dark:text-emerald-400" },
    { label: "61.8%", value: data.fib.fib_61_8 },
    { label: "50.0%", value: data.fib.fib_50 },
    { label: "38.2%", value: data.fib.fib_38_2 },
    { label: "23.6%", value: data.fib.fib_23_6 },
    { label: "52W Low", value: data.fib.low_52week, highlight: "text-rose-600 dark:text-rose-400" },
  ];

  const price = data.close ?? data.fib.px_last;
  const rows: Row[] = [];
  let priceInserted = false;

  if (price != null) {
    for (const lv of fibLevels) {
      if (!priceInserted && lv.value != null && price >= lv.value) {
        rows.push({ label: "Last Price", value: price, isPrice: true });
        priceInserted = true;
      }
      rows.push(lv);
    }
    if (!priceInserted) {
      rows.push({ label: "Last Price", value: price, isPrice: true });
    }
  } else {
    rows.push(...fibLevels);
  }

  return (
    <div className="space-y-1.5">
      {rows.map((lv) => (
        <div
          key={lv.label}
          className={cn(
            "flex items-center justify-between",
            lv.isPrice && "bg-blue-50 dark:bg-blue-950/40 -mx-2 px-2 py-1 rounded-md border border-blue-200 dark:border-blue-800"
          )}
        >
          <span className={cn("text-muted-foreground", lv.isPrice && "text-blue-700 dark:text-blue-300 font-semibold")}>
            {lv.isPrice ? "▸ Last Price" : lv.label}
          </span>
          <span
            className={cn(
              "tabular-nums font-medium",
              lv.isPrice ? "text-blue-700 dark:text-blue-300 font-bold" : lv.highlight
            )}
          >
            {fmt(lv.value)}
          </span>
        </div>
      ))}
    </div>
  );
}
