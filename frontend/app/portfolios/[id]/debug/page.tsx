"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import { PortfolioShell } from "@/components/portfolio-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getPortfolioDebugScreen } from "@/lib/api";
import type { PortfolioDebugScreenResponse, ScreenDebugRow } from "@/lib/types";

type Stage = "return" | "sd" | "rank";
type Score3Signal = "BUY" | "HOLD" | "SELL";

function fmtPct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function fmtNum(v?: number | null, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

// Thresholds match analysis_service._classify and holdings page score3Color.
function score3Signal(v?: number | null): Score3Signal | null {
  if (v == null || Number.isNaN(v)) return null;
  if (v > 1.08) return "BUY";
  if (v < 0.95) return "SELL";
  return "HOLD";
}

const SIGNAL_CLASSES: Record<Score3Signal, string> = {
  BUY: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  HOLD: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  SELL: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

export default function PortfolioDebugPage() {
  const params = useParams<{ id: string | string[] | undefined }>();
  const rawId = params?.id;
  const portfolioId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [data, setData] = React.useState<PortfolioDebugScreenResponse | null>(null);
  const [err, setErr] = React.useState<string>("");
  const [loading, setLoading] = React.useState(true);
  const [stage, setStage] = React.useState<Stage>("return");
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (!portfolioId) return;
    let cancelled = false;
    setLoading(true);
    setErr("");
    getPortfolioDebugScreen(portfolioId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  const [signalFilter, setSignalFilter] = React.useState<"all" | Score3Signal>("all");
  const [manualSort, setManualSort] = React.useState<{ col: string; dir: "asc" | "desc" } | null>(null);

  const rows = React.useMemo(() => data?.rows || [], [data]);
  const screenRows = React.useMemo(() => rows.filter((r) => r.in_screen), [rows]);

  const signalCounts = React.useMemo(() => {
    const base = stage === "return" ? rows : screenRows;
    let buy = 0, hold = 0, sell = 0;
    for (const r of base) {
      const s = score3Signal(r.score_3);
      if (s === "BUY") buy++;
      else if (s === "SELL") sell++;
      else if (s === "HOLD") hold++;
    }
    return { buy, hold, sell };
  }, [rows, screenRows, stage]);

  function toggleSort(col: string) {
    setManualSort((prev) =>
      prev?.col === col
        ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col, dir: col === "symbol" ? "asc" : "desc" }
    );
  }

  const visible = React.useMemo(() => {
    const base =
      stage === "return"
        ? [...rows]
        : [...screenRows];

    // Apply signal filter
    const filtered = signalFilter === "all"
      ? base
      : base.filter((r) => score3Signal(r.score_3) === signalFilter);

    const q = query.trim().toLowerCase();
    const queried = !q
      ? filtered
      : filtered.filter((r) => r.symbol.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q));

    // Sort: manual column sort overrides stage default
    const sorted = [...queried];
    if (manualSort) {
      const { col, dir } = manualSort;
      const mul = dir === "asc" ? 1 : -1;
      sorted.sort((a, b) => {
        let av: number | string | null | undefined;
        let bv: number | string | null | undefined;
        if (col === "symbol") { av = a.symbol; bv = b.symbol; }
        else if (col === "return_1y") { av = a.return_1y; bv = b.return_1y; }
        else if (col === "sd") { av = a.annualized_sd; bv = b.annualized_sd; }
        else if (col === "score_3") { av = a.score_3; bv = b.score_3; }
        else if (col === "ret_rank") { av = a.return_rank; bv = b.return_rank; }
        else if (col === "sd_rank") { av = a.sd_rank; bv = b.sd_rank; }
        else if (col === "comb_score") { av = a.combined_score; bv = b.combined_score; }
        else if (col === "comb_rank") { av = a.combined_rank; bv = b.combined_rank; }
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string" && typeof bv === "string") return mul * av.localeCompare(bv);
        return mul * ((av as number) - (bv as number));
      });
    } else {
      // stage default sort
      if (stage === "return") sorted.sort((a, b) => a.return_rank - b.return_rank);
      else if (stage === "sd") sorted.sort((a, b) => (a.sd_rank ?? 1e9) - (b.sd_rank ?? 1e9));
      else sorted.sort((a, b) => (a.combined_rank ?? 1e9) - (b.combined_rank ?? 1e9));
    }
    return sorted;
  }, [rows, screenRows, stage, query, signalFilter, manualSort]);

  const tabs: { id: Stage; label: string; hint: string }[] = [
    { id: "return", label: `Return (${data?.universe_count ?? rows.length})`, hint: "All universe names ranked by 1Y return" },
    { id: "sd", label: `SD (${screenRows.length})`, hint: `Top ${data?.screen_size ?? "?"} return names re-ranked by volatility (SD)` },
    { id: "rank", label: `RANK (${screenRows.length})`, hint: "Combined rank = return_rank + SD_rank (lower is better)" },
  ];
  const activeHint = tabs.find((t) => t.id === stage)?.hint || "";

  return (
    <PortfolioShell>
      <div className="space-y-4">
        {err ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {err}
          </div>
        ) : null}

        <Card className="shadow-sm">
          <CardContent className="p-3">
            <div className="mb-1 text-sm font-semibold text-foreground">
              MomentumIQ pipeline (DEBUG)
            </div>
            <div className="text-[11px] text-muted-foreground">
              Universe → rank by return → screen top {data?.screen_size ?? "?"} → re-rank by SD →
              combined RANK → top {data?.final_portfolio_size ?? "?"} portfolio.
              {data?.created_at ? ` Snapshot ${new Date(data.created_at).toLocaleString()}.` : ""}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => { setStage(t.id); setManualSort(null); }}
                  className={cn(
                    "rounded-md border px-3 py-1.5 text-xs font-medium",
                    stage === t.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40"
                  )}
                >
                  {t.label}
                </button>
              ))}
              <div className="flex rounded-md border border-border overflow-hidden text-xs">
                {(["all", "BUY", "HOLD", "SELL"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setSignalFilter(f)}
                    className={cn(
                      "px-2.5 py-1.5",
                      signalFilter === f
                        ? f === "BUY" ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium"
                          : f === "SELL" ? "bg-rose-500/20 text-rose-700 dark:text-rose-300 font-medium"
                          : f === "HOLD" ? "bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium"
                          : "bg-primary/10 text-foreground font-medium"
                        : "bg-background text-muted-foreground hover:bg-muted/40"
                    )}
                  >
                    {f === "all" ? "All" : f}
                  </button>
                ))}
              </div>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter symbol…"
                className="ml-auto h-8 w-[150px] rounded-md border border-border bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">{activeHint}</div>
          </CardContent>
        </Card>

        {loading ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading pipeline…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground leading-relaxed max-w-xl mx-auto">
            <div className="text-base font-semibold text-foreground">No pipeline data for this snapshot</div>
            <div className="mt-2">
              The full ranking pipeline is captured on new rebalances. Run a rebalance on the
              Holdings tab and commit it to populate the DEBUG views. (Older / test snapshots
              predate this capture.)
            </div>
          </div>
        ) : (
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{visible.length} rows</Badge>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
                    B {signalCounts.buy}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                    H {signalCounts.hold}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                    S {signalCounts.sell}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="mr-2 inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> in portfolio
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full bg-blue-500" /> in screen
                  </span>
                </div>
              </div>
              <div className="overflow-auto rounded-md border border-border">
                <table className="min-w-[960px] w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-center font-bold text-foreground">
                        {stage === "return" ? "Ret #" : stage === "sd" ? "SD #" : "Rank"}
                      </th>
                      {(
                        [
                          { col: "symbol", label: "Symbol" },
                          { col: null, label: "Name" },
                          { col: null, label: "Sector" },
                          { col: "return_1y", label: "Return 1Y" },
                          { col: "sd", label: "SD" },
                          { col: "score_3", label: "Score 3" },
                          { col: null, label: "Signal" },
                          { col: "ret_rank", label: "Ret #" },
                          { col: "sd_rank", label: "SD #" },
                          { col: "comb_score", label: "Comb. score" },
                          { col: "comb_rank", label: "Comb. rank" },
                        ] as { col: string | null; label: string }[]
                      ).map(({ col, label }) => (
                        <th
                          key={label}
                          className={cn(
                            "px-3 py-2 select-none text-center font-bold text-foreground",
                            col ? "cursor-pointer hover:text-primary" : ""
                          )}
                          onClick={col ? () => toggleSort(col) : undefined}
                        >
                          <span className="inline-flex items-center gap-0.5">
                            {label}
                            {col && manualSort?.col === col ? (
                              <span className="text-primary">{manualSort.dir === "asc" ? " ↑" : " ↓"}</span>
                            ) : col ? (
                              <span className="opacity-30"> ↕</span>
                            ) : null}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r: ScreenDebugRow) => {
                      const sig = score3Signal(r.score_3);
                      return (
                        <tr
                          key={r.symbol}
                          className={cn(
                            "border-t border-border",
                            r.in_portfolio
                              ? "border-l-[3px] border-l-emerald-500/70"
                              : r.in_screen
                                ? "border-l-[3px] border-l-blue-500/40"
                                : "border-l-[3px] border-l-transparent"
                          )}
                        >
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {stage === "return"
                              ? r.return_rank
                              : stage === "sd"
                                ? r.sd_rank ?? "—"
                                : r.combined_rank ?? "—"}
                          </td>
                          <td className="px-3 py-2 font-semibold text-foreground">{r.symbol}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <div className="max-w-[200px] truncate" title={r.name || ""}>
                              {r.name || "—"}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{r.sector || "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.return_1y)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtPct(r.annualized_sd)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.score_3 != null ? fmtNum(r.score_3, 3) : "—"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {sig ? (
                              <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", SIGNAL_CLASSES[sig])}>
                                {sig}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.return_rank}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.sd_rank ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.combined_score ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.combined_rank ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PortfolioShell>
  );
}
