import { cn } from "@/lib/utils";
import type { StockDetailsResponse } from "@/lib/types";

function fmt(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

export function FibPanel({ data }: { data: StockDetailsResponse }) {
  const levels = [
    { label: "52W High", value: data.fib.high_52week, highlight: "text-emerald-600 dark:text-emerald-400" },
    { label: "61.8%", value: data.fib.fib_61_8 },
    { label: "50.0%", value: data.fib.fib_50 },
    { label: "38.2%", value: data.fib.fib_38_2 },
    { label: "23.6%", value: data.fib.fib_23_6 },
    { label: "52W Low", value: data.fib.low_52week, highlight: "text-rose-600 dark:text-rose-400" },
  ] as const;

  return (
    <div className="space-y-1.5">
      {levels.map((lv) => (
        <div key={lv.label} className="flex items-center justify-between">
          <span className="text-muted-foreground">{lv.label}</span>
          <span className={cn("tabular-nums font-medium", lv.highlight)}>{fmt(lv.value)}</span>
        </div>
      ))}
    </div>
  );
}
