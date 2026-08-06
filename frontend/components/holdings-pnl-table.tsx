"use client";

import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { SortableTh, sortRows, useTableSort } from "@/components/sortable-th";
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

type PnlSortKey =
  | "symbol"
  | "sector"
  | "entry_price"
  | "entry_date"
  | "current_price"
  | "exit_date"
  | "pnl_pct"
  | "pnl_abs"
  | "days_held"
  | "status";

type StatusFilter = "all" | "open" | "exited";

export function HoldingsPnlTable({ rows }: { rows: HoldingsPnlRow[] }) {
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const { sort, toggle } = useTableSort<PnlSortKey>({ key: "pnl_pct", dir: "desc" });

  const openRows = React.useMemo(() => (rows || []).filter((r) => (r.status || "open") === "open"), [rows]);
  const exitedRows = React.useMemo(() => (rows || []).filter((r) => r.status === "exited"), [rows]);

  const avg = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const avgUnrealized = React.useMemo(() => avg(openRows.map((r) => r.pnl_pct)), [openRows]);
  const avgRealized = React.useMemo(() => avg(exitedRows.map((r) => r.pnl_pct)), [exitedRows]);

  const visible = React.useMemo(() => {
    const base =
      statusFilter === "open" ? openRows : statusFilter === "exited" ? exitedRows : rows || [];
    return sortRows(base, sort, (r, key) => {
      switch (key) {
        case "symbol":
          return r.symbol;
        case "sector":
          return r.sector ?? null;
        case "entry_price":
          return r.entry_price;
        case "entry_date":
          return r.entry_date;
        case "current_price":
          return r.current_price ?? null;
        case "exit_date":
          return r.exit_date ?? null;
        case "pnl_pct":
          return r.pnl_pct ?? null;
        case "pnl_abs":
          return r.pnl_abs ?? null;
        case "days_held":
          return r.days_held ?? null;
        case "status":
          return r.status || "open";
      }
    });
  }, [rows, openRows, exitedRows, statusFilter, sort]);

  return (
    <Card className="shadow-sm">
      <CardContent className="p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-foreground">Holdings P&amp;L</div>
            <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              {openRows.length} open{avgUnrealized != null ? ` · avg ${fmtPct(avgUnrealized)}` : ""}
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-500/15 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:text-slate-300">
              {exitedRows.length} exited{avgRealized != null ? ` · avg ${fmtPct(avgRealized)}` : ""}
            </span>
          </div>
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {(["all", "open", "exited"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={cn(
                  "px-2.5 py-1",
                  statusFilter === f
                    ? "bg-primary/10 font-medium text-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted/40"
                )}
              >
                {f === "all" ? "All" : f === "open" ? "Open" : "Exited"}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 overflow-auto">
          <table className="w-full min-w-[1020px] border-collapse text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-[11px] text-muted-foreground">
                <SortableTh label="Symbol" sortKey="symbol" sort={sort} onToggle={toggle} defaultDir="asc" className="px-2 py-2" />
                <th className="px-2 py-2 text-center font-semibold">Name</th>
                <SortableTh label="Sector" sortKey="sector" sort={sort} onToggle={toggle} defaultDir="asc" className="px-2 py-2" />
                <SortableTh label="Status" sortKey="status" sort={sort} onToggle={toggle} defaultDir="asc" className="px-2 py-2" />
                <SortableTh label="Entry" sortKey="entry_price" sort={sort} onToggle={toggle} className="px-2 py-2" />
                <SortableTh label="Entry date" sortKey="entry_date" sort={sort} onToggle={toggle} className="px-2 py-2" />
                <SortableTh label="Current / Exit" sortKey="current_price" sort={sort} onToggle={toggle} className="px-2 py-2" title="Latest close for open positions; exit price for exited" />
                <SortableTh label="Exit date" sortKey="exit_date" sort={sort} onToggle={toggle} className="px-2 py-2" />
                <SortableTh label="% P&L" sortKey="pnl_pct" sort={sort} onToggle={toggle} className="px-2 py-2" />
                <SortableTh label="Abs" sortKey="pnl_abs" sort={sort} onToggle={toggle} className="px-2 py-2" />
                <SortableTh label="Days" sortKey="days_held" sort={sort} onToggle={toggle} className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {!visible.length ? (
                <tr className="border-b border-border">
                  <td className="px-2 py-4 text-muted-foreground" colSpan={11}>
                    No P&amp;L data yet.
                  </td>
                </tr>
              ) : (
                visible.map((r) => {
                  const exited = r.status === "exited";
                  return (
                    <tr
                      // A symbol can appear multiple times (one row per entry→exit leg).
                      key={`${r.symbol}-${r.entry_date}`}
                      className={cn(
                        "border-b border-border hover:bg-muted/30",
                        exited ? "text-muted-foreground" : ""
                      )}
                    >
                      <td className="px-2 py-2 font-semibold text-foreground">{r.symbol}</td>
                      <td className="px-2 py-2 max-w-[220px] truncate" title={r.name || ""}>
                        {r.name || "—"}
                      </td>
                      <td className="px-2 py-2">{r.sector || "—"}</td>
                      <td className="px-2 py-2 text-center">
                        {exited ? (
                          <span className="inline-flex rounded-full bg-slate-500/15 px-2 py-0.5 text-[10.5px] font-medium text-slate-700 dark:text-slate-300">
                            Exited
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
                            Open
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.entry_price)}</td>
                      <td className="px-2 py-2">{r.entry_date}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{fmtMoney(r.current_price)}</td>
                      <td className="px-2 py-2">{r.exit_date || "—"}</td>
                      <td className={cn("px-2 py-2 text-right tabular-nums font-medium", pctColor(r.pnl_pct))}>
                        {fmtPct(r.pnl_pct)}
                      </td>
                      <td className={cn("px-2 py-2 text-right tabular-nums", pctColor(r.pnl_pct))}>
                        {fmtMoney(r.pnl_abs)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{r.days_held ?? 0}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Open positions mark to the latest close; exited positions freeze P&amp;L at the exit price
          (realized). Abs P&amp;L is per-share (current − entry) under equal-weight tracking.
        </div>
      </CardContent>
    </Card>
  );
}
