"use client";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Escape double quotes and wrap when needed
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const cols =
    columns && columns.length
      ? columns
      : Array.from(
          rows.reduce((set, r) => {
            Object.keys(r).forEach((k) => set.add(k));
            return set;
          }, new Set<string>())
        );
  const lines: string[] = [];
  lines.push(cols.map(esc).join(","));
  for (const r of rows) {
    lines.push(cols.map((c) => esc(r[c])).join(","));
  }
  return lines.join("\n");
}

export function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

