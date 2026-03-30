import { cn } from "@/lib/utils";
import type { StockDetailsResponse } from "@/lib/types";

function fmt(n?: number | null) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

type Row = {
  label: string;
  value: number | null | undefined;
  color?: string;
  isPrice?: boolean;
};

function buildRows(
  levels: Row[],
  price: number | null | undefined
): Row[] {
  const rows: Row[] = [];
  let inserted = false;

  if (price != null) {
    for (const lv of levels) {
      if (!inserted && lv.value != null && price >= lv.value) {
        rows.push({ label: "Last Price", value: price, isPrice: true });
        inserted = true;
      }
      rows.push(lv);
    }
    if (!inserted) {
      rows.push({ label: "Last Price", value: price, isPrice: true });
    }
  } else {
    rows.push(...levels);
  }

  return rows;
}

function FibTable({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <div>
      <div className="text-xs sm:text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">
        {title}
      </div>
      <div className="space-y-1">
        {rows.map((lv, i) =>
          lv.isPrice ? (
            <div
              key={`price-${i}`}
              className="flex items-center justify-between rounded-md px-3 py-2 -mx-1 bg-gradient-to-r from-amber-50 to-amber-100/80 dark:from-amber-950/40 dark:to-amber-900/30 border border-amber-300/60 dark:border-amber-700/50"
            >
              <span className="text-amber-800 dark:text-amber-300 font-semibold text-sm flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                Last Price
              </span>
              <span className="tabular-nums font-bold text-base text-amber-900 dark:text-amber-200">
                {fmt(lv.value)}
              </span>
            </div>
          ) : (
            <div
              key={lv.label}
              className="flex items-center justify-between py-1 text-sm"
            >
              <span className="text-muted-foreground">{lv.label}</span>
              <span className={cn("tabular-nums font-semibold", lv.color)}>
                {fmt(lv.value)}
              </span>
            </div>
          )
        )}
      </div>
    </div>
  );
}

export function FibPanel({ data }: { data: StockDetailsResponse }) {
  const price = data.close ?? data.fib.px_last;

  const levels52w: Row[] = [
    { label: "52W High", value: data.fib.high_52week, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "61.8%", value: data.fib.fib_61_8, color: "text-emerald-500/80 dark:text-emerald-500/70" },
    { label: "50.0%", value: data.fib.fib_50 },
    { label: "38.2%", value: data.fib.fib_38_2 },
    { label: "23.6%", value: data.fib.fib_23_6, color: "text-rose-500/80 dark:text-rose-400/70" },
    { label: "52W Low", value: data.fib.low_52week, color: "text-rose-600 dark:text-rose-400" },
  ];

  const fib30 = data.fib_30d;
  const levels30d: Row[] = fib30
    ? [
        { label: "30D High", value: fib30.high_30d, color: "text-emerald-600 dark:text-emerald-400" },
        { label: "61.8%", value: fib30.fib_61_8, color: "text-emerald-500/80 dark:text-emerald-500/70" },
        { label: "50.0%", value: fib30.fib_50 },
        { label: "38.2%", value: fib30.fib_38_2 },
        { label: "23.6%", value: fib30.fib_23_6, color: "text-rose-500/80 dark:text-rose-400/70" },
        { label: "30D Low", value: fib30.low_30d, color: "text-rose-600 dark:text-rose-400" },
      ]
    : [];

  const rows52w = buildRows(levels52w, price);
  const rows30d = fib30 ? buildRows(levels30d, price) : [];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 sm:gap-10">
      <FibTable title="Fibonacci (52W)" rows={rows52w} />
      {rows30d.length > 0 && <FibTable title="Fibonacci (30D)" rows={rows30d} />}
    </div>
  );
}
