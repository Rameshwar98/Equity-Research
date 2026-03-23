"use client";

import * as React from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";

import { TrendBadge } from "@/components/trend-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { AnalysisRow, RunAnalysisResponse, Signal } from "@/lib/types";

function fmtScore(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(4);
}

function headerForIdx(dateLabels: string[], i: number) {
  // Use the actual date label for every column (so T-2/T-3/etc become real dates).
  return dateLabels[i] ?? `T-${i}`;
}

function toCsv(resp: RunAnalysisResponse) {
  const headers = [
    "name",
    "symbol",
    "sector",
    "sub_sector",
    "score_1",
    "score_2",
    "score_3",
    ...resp.date_labels.map((_, i) => headerForIdx(resp.date_labels, i)),
  ];
  const lines = [headers.join(",")];
  for (const r of resp.rows) {
    const row = [
      JSON.stringify(r.name ?? ""),
      JSON.stringify(r.symbol),
      JSON.stringify(r.sector ?? ""),
      JSON.stringify(r.sub_sector ?? ""),
      r.score_1 ?? "",
      r.score_2 ?? "",
      r.score_3 ?? "",
      ...r.signals,
    ];
    lines.push(row.join(","));
  }
  return lines.join("\n");
}

function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AnalysisTable({
  data,
  onRowClick,
  sectors = [],
  subSectors = [],
  sectorFilter,
  subSectorFilter,
  onSectorChange,
  onSubSectorChange,
  allValue = "__all__",
}: {
  data: RunAnalysisResponse;
  onRowClick: (row: AnalysisRow) => void;
  sectors?: string[];
  subSectors?: string[];
  sectorFilter?: string;
  subSectorFilter?: string;
  onSectorChange?: (v: string) => void;
  onSubSectorChange?: (v: string) => void;
  allValue?: string;
}) {
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: data.metadata.selected_score, desc: true },
  ]);
  const [globalFilter, setGlobalFilter] = React.useState("");

  const columns = React.useMemo<ColumnDef<AnalysisRow>[]>(() => {
    const signalCols: ColumnDef<AnalysisRow>[] = Array.from({ length: 16 }).map(
      (_, i) => ({
        id: `sig_${i}`,
        header: () => (
          <div className="whitespace-nowrap">
            {headerForIdx(data.date_labels, i)}
          </div>
        ),
        cell: ({ row }) => {
          const sig = row.original.signals[i] as Signal | undefined;
          return sig ? <TrendBadge signal={sig} /> : <TrendBadge signal="N/A" />;
        },
      })
    );

    return [
      {
        accessorKey: "name",
        header: "Stock Name",
        cell: ({ row }) => (
          <div className="max-w-[220px] truncate">
            {row.original.name ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "symbol",
        header: "Symbol",
        cell: ({ row }) => (
          <div className="font-mono text-xs">{row.original.symbol}</div>
        ),
      },
      {
        accessorKey: "sector",
        header: "Sector",
        cell: ({ row }) => (
          <div className="max-w-[140px] truncate text-xs text-muted-foreground">
            {row.original.sector ?? "—"}
          </div>
        ),
      },
      {
        accessorKey: "score_1",
        header: "Score 1",
        cell: ({ row }) => (
          <div className="tabular-nums">{fmtScore(row.original.score_1)}</div>
        ),
      },
      {
        accessorKey: "score_2",
        header: "Score 2",
        cell: ({ row }) => (
          <div className="tabular-nums">{fmtScore(row.original.score_2)}</div>
        ),
      },
      {
        accessorKey: "score_3",
        header: "Score 3",
        cell: ({ row }) => (
          <div className="tabular-nums">{fmtScore(row.original.score_3)}</div>
        ),
      },
      ...signalCols,
    ];
  }, [data.date_labels, data.metadata.selected_score]);

  const table = useReactTable({
    data: data.rows,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _colId, filterValue) => {
      const q = String(filterValue || "").toLowerCase().trim();
      if (!q) return true;
      const name = String(row.original.name || "").toLowerCase();
      const sym = String(row.original.symbol || "").toLowerCase();
      return name.includes(q) || sym.includes(q);
    },
  });

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Search symbol or name…"
            className="w-[200px]"
          />
          {sectors.length > 0 && onSectorChange && (
            <Select value={sectorFilter ?? allValue} onValueChange={onSectorChange}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Sectors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allValue}>All Sectors</SelectItem>
                {sectors.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {subSectors.length > 0 && onSubSectorChange && (
            <Select value={subSectorFilter ?? allValue} onValueChange={onSubSectorChange}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Sub-sectors" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={allValue}>All Sub-sectors</SelectItem>
                {subSectors.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(sectorFilter && sectorFilter !== allValue || subSectorFilter && subSectorFilter !== allValue) && onSectorChange && onSubSectorChange && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { onSectorChange(allValue); onSubSectorChange(allValue); }}
            >
              Clear
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => {
              const csv = toCsv(data);
              download(`analysis-${data.metadata.index_name}.csv`, csv);
            }}
          >
            Export CSV
          </Button>
        </div>
        <div className="text-sm text-muted-foreground">
          Showing {table.getRowModel().rows.length} of {data.rows.length}
        </div>
      </div>

      <div className="max-h-[68vh] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className={cn(
                      "px-3 py-2 text-left font-medium text-muted-foreground",
                      h.column.getCanSort() ? "cursor-pointer select-none" : ""
                    )}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => {
              const today = r.original.signals[0];
              const tint =
                today === "BUY"
                  ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                  : today === "SELL"
                    ? "bg-rose-500/5 hover:bg-rose-500/10"
                    : "hover:bg-muted/40";
              return (
                <tr
                  key={r.id}
                  className={cn("border-b transition-colors", tint)}
                  onClick={() => onRowClick(r.original)}
                  role="button"
                >
                  {r.getVisibleCells().map((c) => (
                    <td key={c.id} className="px-3 py-2 align-middle">
                      {flexRender(c.column.columnDef.cell, c.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 p-4">
        <div className="text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of{" "}
          {table.getPageCount()}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

