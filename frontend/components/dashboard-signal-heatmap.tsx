"use client";

import type { Signal } from "@/lib/types";
import { cn } from "@/lib/utils";

const SEG: Record<Signal, string> = {
  BUY: "bg-emerald-500",
  HOLD: "bg-amber-400",
  SELL: "bg-rose-500",
  "N/A": "bg-zinc-300 dark:bg-zinc-600",
};

function fmtTip(iso: string | undefined, sig: Signal) {
  if (!iso) return sig;
  const parts = iso.split("-");
  if (parts.length !== 3) return `${iso} · ${sig}`;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!y || !m || !d) return `${iso} · ${sig}`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const when = `${wd}, ${MONTHS[m - 1]} ${d}, ${y}`;
  return `${when} · ${sig}`;
}

export function DashboardSignalHeatmap({
  signals,
  dates,
}: {
  signals: Signal[] | undefined | null;
  dates?: string[] | null;
}) {
  const s = signals ?? [];
  if (s.length === 0) {
    return <span className="text-muted-foreground text-[10px] tabular-nums">—</span>;
  }

  return (
    <div
      className="flex h-5 w-[min(100%,14rem)] min-w-[8rem] max-w-[14rem] shrink-0 overflow-hidden rounded-sm border border-border/70"
      title="Weekly signals (~1 year, oldest → newest)"
    >
      {s.map((sig, i) => (
        <div
          key={i}
          className={cn("h-full min-w-px flex-1", SEG[sig] ?? SEG["N/A"])}
          title={fmtTip(dates?.[i], sig)}
        />
      ))}
    </div>
  );
}
