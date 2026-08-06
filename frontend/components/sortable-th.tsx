"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";
export type SortState<K extends string = string> = { key: K; dir: SortDir } | null;

/** Column-header sort state. `toggle(key)` cycles: default dir → flipped → (same key again) flipped back. */
export function useTableSort<K extends string = string>(initial: SortState<K> = null) {
  const [sort, setSort] = React.useState<SortState<K>>(initial);
  const toggle = React.useCallback((key: K, defaultDir: SortDir = "desc") => {
    setSort((prev) =>
      prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: defaultDir }
    );
  }, []);
  return { sort, toggle, setSort };
}

/** Generic comparator: numbers numeric, strings locale, null/undefined always last. */
export function sortRows<T, K extends string = string>(
  rows: T[],
  sort: SortState<K>,
  accessor: (row: T, key: K) => number | string | null | undefined
): T[] {
  if (!sort) return rows;
  const mul = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a, sort.key);
    const bv = accessor(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" || typeof bv === "string") {
      return mul * String(av).localeCompare(String(bv));
    }
    return mul * ((av as number) - (bv as number));
  });
}

export function SortableTh<K extends string = string>({
  label,
  sortKey,
  sort,
  onToggle,
  defaultDir = "desc",
  /** Header labels are centred everywhere for a symmetrical grid; body cells keep their
   *  own alignment (numbers right) so figures stay comparable down a column. */
  align = "center",
  className,
  title,
}: {
  label: React.ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onToggle: (key: K, defaultDir?: SortDir) => void;
  defaultDir?: SortDir;
  align?: "left" | "right" | "center";
  className?: string;
  title?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th
      className={cn(
        // Full-contrast + bold: headers inherit a muted grey from thead/tr, which makes
        // even semibold read as light. text-foreground on the cell wins over inheritance.
        "cursor-pointer select-none font-bold text-foreground hover:text-primary",
        align === "right" ? "text-right" : align === "left" ? "text-left" : "text-center",
        className
      )}
      onClick={() => onToggle(sortKey, defaultDir)}
      title={title}
      aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active ? (
          <span className="text-primary">{sort!.dir === "asc" ? "↑" : "↓"}</span>
        ) : (
          <span className="opacity-30">↕</span>
        )}
      </span>
    </th>
  );
}
