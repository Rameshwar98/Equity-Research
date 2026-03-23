"use client";

import * as React from "react";
import type { Signal } from "@/lib/types";
import { cn } from "@/lib/utils";

const DOT: Record<Signal, string> = {
  BUY: "bg-emerald-500",
  HOLD: "bg-amber-400",
  SELL: "bg-rose-500",
  "N/A": "bg-zinc-400 dark:bg-zinc-500",
};

const TEXT: Record<Signal, string> = {
  BUY: "text-emerald-600 dark:text-emerald-400",
  HOLD: "text-amber-600 dark:text-amber-300",
  SELL: "text-rose-600 dark:text-rose-400",
  "N/A": "text-muted-foreground",
};

function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthTitle(ym: string) {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type Entry = { date: string; signal: Signal; close: number | null };
type Group = { key: string; title: string; entries: Entry[] };

function buildGroups(
  dates: string[],
  signals: Signal[],
  closes?: (number | null)[]
): Group[] {
  const map = new Map<string, Group>();
  for (let i = 0; i < dates.length; i++) {
    const mk = monthKey(dates[i]);
    if (!map.has(mk)) map.set(mk, { key: mk, title: monthTitle(mk), entries: [] });
    map.get(mk)!.entries.push({
      date: dates[i],
      signal: signals[i],
      close: closes?.[i] ?? null,
    });
  }
  const groups = Array.from(map.values());
  groups.forEach((g) => g.entries.sort((a, b) => b.date.localeCompare(a.date)));
  groups.sort((a, b) => b.key.localeCompare(a.key));
  return groups;
}

export function SignalTimeline({
  dateLabels,
  signals,
  closes,
}: {
  dateLabels: string[];
  signals: Signal[];
  closes?: (number | null)[];
}) {
  const groups = React.useMemo(
    () => buildGroups(dateLabels, signals, closes),
    [dateLabels, signals, closes]
  );
  const hasCloses = closes && closes.some((c) => c != null);

  return (
    <div className="max-h-[520px] overflow-y-auto pr-1">
      <table className="w-full text-xs">
        <tbody>
          {groups.map((g) => (
            <React.Fragment key={g.key}>
              <tr>
                <td
                  colSpan={hasCloses ? 4 : 3}
                  className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b"
                >
                  {g.title}
                </td>
              </tr>
              {g.entries.map((e) => (
                <tr key={e.date} className="hover:bg-muted/30 transition-colors">
                  <td className="py-1.5 pl-1 w-5">
                    <span className={cn("inline-block h-2 w-2 rounded-full", DOT[e.signal])} />
                  </td>
                  <td className="py-1.5 tabular-nums text-muted-foreground">
                    {fmtDate(e.date)}
                  </td>
                  {hasCloses && (
                    <td className="py-1.5 tabular-nums text-muted-foreground text-right">
                      {e.close != null ? e.close.toFixed(2) : "—"}
                    </td>
                  )}
                  <td className={cn("py-1.5 text-right font-medium pr-1", TEXT[e.signal])}>
                    {e.signal}
                  </td>
                </tr>
              ))}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
