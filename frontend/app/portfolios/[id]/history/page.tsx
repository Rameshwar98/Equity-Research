"use client";

import * as React from "react";
import { useParams } from "next/navigation";

import { PortfolioShell } from "@/components/portfolio-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPortfolioHistory, updatePortfolioPrefs } from "@/lib/api";
import { downloadCsv, toCsv } from "@/lib/csv";
import type { PortfolioHistoryResponse } from "@/lib/types";
import { DurationHistogram, RankHeatmap, TurnoverBarChart } from "@/components/history-charts";

export default function PortfolioHistoryPage() {
  const params = useParams<{ id: string }>();
  const portfolioId = params.id;

  const [data, setData] = React.useState<PortfolioHistoryResponse | null>(null);
  const [err, setErr] = React.useState<string>("");
  const [loading, setLoading] = React.useState<boolean>(true);
  const [selectedSnapshotId, setSelectedSnapshotId] = React.useState<string>("");
  const [saving, setSaving] = React.useState<boolean>(false);

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setErr("");
      try {
        const d = await getPortfolioHistory(portfolioId);
        if (cancelled) return;
        setData(d);
        setSelectedSnapshotId(d.snapshots[d.snapshots.length - 1]?.snapshot_id || "");
      } catch (e) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [portfolioId]);

  const prefsKey = React.useCallback((k: string) => `history_${k}`, []);
  const isShown = React.useCallback(
    (k: string) => {
      // History prefs stored in portfolio chart_prefs; default true.
      // We don't have portfolio object here; we can still toggle by writing just this key.
      // Backend merges chart_prefs.
      // To keep UI deterministic, we also store local overrides inside this component via data?. (none).
      return true;
    },
    []
  );

  async function hide(key: string) {
    setSaving(true);
    setErr("");
    try {
      await updatePortfolioPrefs(portfolioId, { [prefsKey(key)]: false });
      // no need to refetch; local state hides via local key map below
      setLocalHidden((cur) => ({ ...cur, [key]: true }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const [localHidden, setLocalHidden] = React.useState<Record<string, boolean>>({});
  const show = (key: string) => !localHidden[key];

  const snapshots = data?.snapshots || [];
  const movements = data?.movements || [];
  const events = data?.events || [];
  const charts = data?.charts;

  const selectedHoldings = React.useMemo(() => {
    if (!data || !selectedSnapshotId) return [];
    return data.holdings_by_snapshot[selectedSnapshotId] || [];
  }, [data, selectedSnapshotId]);

  const heatmapColumns = data?.charts?.heatmap_columns || [];

  return (
    <PortfolioShell>
      <div className="space-y-4">
        {err ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {err}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Snapshots {snapshots.length || "—"}</Badge>
          {saving ? <Badge variant="secondary">Saving…</Badge> : null}
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                downloadCsv(`history-movements-${portfolioId}.csv`, toCsv(movements));
              }}
              disabled={!movements.length}
            >
              Export movements CSV
            </Button>
            <Button
              className="ml-2"
              variant="outline"
              size="sm"
              onClick={() => {
                downloadCsv(`history-events-${portfolioId}.csv`, toCsv(events));
              }}
              disabled={!events.length}
            >
              Export events CSV
            </Button>
            <Button
              className="ml-2"
              variant="outline"
              size="sm"
              onClick={() => {
                setData(null);
                setErr("");
                setLoading(true);
                getPortfolioHistory(portfolioId)
                  .then((d) => {
                    setData(d);
                    setSelectedSnapshotId(d.snapshots[d.snapshots.length - 1]?.snapshot_id || "");
                  })
                  .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                  .finally(() => setLoading(false));
              }}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        </div>

        {loading || !data ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading history…
          </div>
        ) : snapshots.length < 1 ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            No snapshots yet. Run a rebalance and commit it to start the audit trail.
          </div>
        ) : (
          <>
            {/* Snapshot timeline */}
            <Card className="shadow-sm">
              <CardContent className="p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Snapshot timeline</div>
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {snapshots.map((s, idx) => {
                    const active = s.snapshot_id === selectedSnapshotId;
                    return (
                      <button
                        // snapshot_id is not guaranteed unique (backend may reuse ids across imports);
                        // include effective_date + index to keep React keys unique and stable enough for UI.
                        key={`${s.snapshot_id}-${s.effective_date}-${idx}`}
                        onClick={() => setSelectedSnapshotId(s.snapshot_id)}
                        className={[
                          "min-w-[160px] rounded-lg border px-3 py-2 text-left",
                          active
                            ? "border-primary bg-primary/5"
                            : "border-border bg-background hover:bg-muted/40",
                        ].join(" ")}
                      >
                        <div className="text-xs text-muted-foreground">{s.effective_date}</div>
                        <div className="mt-1 text-sm font-semibold text-foreground">
                          {s.holdings_count} holdings
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Side panel style: keep simple as a card with table */}
            <Card className="shadow-sm">
              <CardContent className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Snapshot holdings</div>
                    <div className="text-[11px] text-muted-foreground">
                      {snapshots.find((s) => s.snapshot_id === selectedSnapshotId)?.effective_date || "—"}
                    </div>
                  </div>
                  <Badge variant="secondary">{selectedHoldings.length} names</Badge>
                </div>
                <div className="overflow-auto rounded-md border border-border">
                  <table className="min-w-[760px] w-full text-sm">
                    <thead className="bg-muted/40 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Symbol</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-3 py-2 text-left">Sector</th>
                        <th className="px-3 py-2 text-right">Rank</th>
                        <th className="px-3 py-2 text-right">12M</th>
                        <th className="px-3 py-2 text-right">SD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedHoldings
                        .slice()
                        .sort((a, b) => a.combined_rank - b.combined_rank)
                        .map((h) => (
                          <tr key={h.symbol} className="border-t border-border">
                            <td className="px-3 py-2 font-semibold text-foreground">{h.symbol}</td>
                            <td className="px-3 py-2 text-muted-foreground">{h.name || ""}</td>
                            <td className="px-3 py-2 text-muted-foreground">{h.sector || ""}</td>
                            <td className="px-3 py-2 text-right">{h.combined_rank}</td>
                            <td className="px-3 py-2 text-right">{(h.return_1y * 100).toFixed(1)}%</td>
                            <td className="px-3 py-2 text-right">{(h.annualized_sd * 100).toFixed(1)}%</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {snapshots.length < 2 ? (
              <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
                Not enough history yet. Commit at least one more snapshot to unlock movement + charts.
              </div>
            ) : (
              <>
                {/* Monthly movement table + events feed */}
                <div className="grid gap-3 lg:grid-cols-2">
                  <Card className="shadow-sm">
                    <CardContent className="p-4">
                      <div className="mb-2 text-sm font-semibold text-foreground">Monthly movement</div>
                      <div className="overflow-auto rounded-md border border-border">
                        <table className="min-w-[520px] w-full text-sm">
                          <thead className="bg-muted/40 text-xs text-muted-foreground">
                            <tr>
                              <th className="px-3 py-2 text-left">Date</th>
                              <th className="px-3 py-2 text-right">Entries</th>
                              <th className="px-3 py-2 text-right">Exits</th>
                              <th className="px-3 py-2 text-right">Turnover</th>
                            </tr>
                          </thead>
                          <tbody>
                            {movements
                              .slice()
                              .sort((a, b) => a.effective_date.localeCompare(b.effective_date))
                              .map((m, idx) => (
                                <tr
                                  key={`${m.snapshot_id}-${m.effective_date}-${idx}`}
                                  className="border-t border-border"
                                >
                                  <td className="px-3 py-2">{m.effective_date}</td>
                                  <td className="px-3 py-2 text-right">{m.entries}</td>
                                  <td className="px-3 py-2 text-right">{m.exits}</td>
                                  <td className="px-3 py-2 text-right">
                                    {(m.turnover_pct * 100).toFixed(0)}%
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm">
                    <CardContent className="p-4">
                      <div className="mb-2 text-sm font-semibold text-foreground">Entries & exits</div>
                      <div className="max-h-[320px] overflow-auto rounded-md border border-border">
                        <div className="divide-y divide-border">
                          {events
                            .slice()
                            .sort((a, b) => a.created_at.localeCompare(b.created_at))
                            .map((e, idx) => (
                              <div key={`${e.created_at}-${e.symbol}-${idx}`} className="p-3 text-sm">
                                <div className="flex items-center justify-between">
                                  <div className="font-semibold text-foreground">
                                    {e.type === "entry" ? "Entry" : "Exit"} · {e.symbol}
                                  </div>
                                  <div className="text-xs text-muted-foreground">{e.effective_date}</div>
                                </div>
                                <div className="mt-1 text-[12px] text-muted-foreground">
                                  {e.name ? <span>{e.name}</span> : null}
                                  {e.sector ? <span> · {e.sector}</span> : null}
                                  {e.rank != null ? <span> · Rank {e.rank}</span> : null}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts */}
                <div className="grid gap-3 lg:grid-cols-2">
                  {show("turnover") ? (
                    <TurnoverBarChart data={charts?.turnover || []} onHide={() => hide("turnover")} />
                  ) : null}
                  {show("duration") ? (
                    <DurationHistogram
                      data={charts?.duration_histogram || []}
                      onHide={() => hide("duration")}
                    />
                  ) : null}
                </div>

                {show("heatmap") ? (
                  <RankHeatmap
                    columns={heatmapColumns}
                    rows={charts?.rank_heatmap || []}
                    onHide={() => hide("heatmap")}
                  />
                ) : null}

                <Card className="shadow-sm">
                  <CardContent className="p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-foreground">Most stable holdings</div>
                      <button
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => hide("stable")}
                      >
                        Hide
                      </button>
                    </div>
                    <div className="overflow-auto rounded-md border border-border">
                      <table className="min-w-[640px] w-full text-sm">
                        <thead className="bg-muted/40 text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left">Symbol</th>
                            <th className="px-3 py-2 text-left">Sector</th>
                            <th className="px-3 py-2 text-right">Total held</th>
                            <th className="px-3 py-2 text-right">Longest streak</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(charts?.most_stable_holdings || []).map((r) => (
                            <tr key={r.symbol} className="border-t border-border">
                              <td className="px-3 py-2 font-semibold text-foreground">{r.symbol}</td>
                              <td className="px-3 py-2 text-muted-foreground">{r.sector || ""}</td>
                              <td className="px-3 py-2 text-right">{r.total_snapshots_held}</td>
                              <td className="px-3 py-2 text-right">{r.longest_streak}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </PortfolioShell>
  );
}

