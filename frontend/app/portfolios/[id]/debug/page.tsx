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

function fmtPct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function fmtNum(v?: number | null, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

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

  const rows = React.useMemo(() => data?.rows || [], [data]);
  const screenRows = React.useMemo(() => rows.filter((r) => r.in_screen), [rows]);

  const visible = React.useMemo(() => {
    const base =
      stage === "return"
        ? [...rows].sort((a, b) => a.return_rank - b.return_rank)
        : stage === "sd"
          ? [...screenRows].sort((a, b) => (a.sd_rank ?? 1e9) - (b.sd_rank ?? 1e9))
          : [...screenRows].sort((a, b) => (a.combined_rank ?? 1e9) - (b.combined_rank ?? 1e9));
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) => r.symbol.toLowerCase().includes(q) || (r.name || "").toLowerCase().includes(q)
    );
  }, [rows, screenRows, stage, query]);

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
                  onClick={() => setStage(t.id)}
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
              <div className="mb-2 flex items-center justify-between">
                <Badge variant="secondary">{visible.length} rows</Badge>
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
                <table className="min-w-[820px] w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-right">
                        {stage === "return" ? "Ret #" : stage === "sd" ? "SD #" : "Rank"}
                      </th>
                      <th className="px-3 py-2 text-left">Symbol</th>
                      <th className="px-3 py-2 text-left">Name</th>
                      <th className="px-3 py-2 text-left">Sector</th>
                      <th className="px-3 py-2 text-right">Return 1Y</th>
                      <th className="px-3 py-2 text-right">SD</th>
                      <th className="px-3 py-2 text-right">Ret #</th>
                      <th className="px-3 py-2 text-right">SD #</th>
                      <th className="px-3 py-2 text-right">Comb. score</th>
                      <th className="px-3 py-2 text-right">Comb. rank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r: ScreenDebugRow) => (
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
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.return_rank}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.sd_rank ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.combined_score ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.combined_rank ?? "—"}</td>
                      </tr>
                    ))}
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
