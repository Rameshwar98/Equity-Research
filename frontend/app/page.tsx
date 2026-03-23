"use client";

import * as React from "react";

import { AnalysisTable } from "@/components/analysis-table";
import { ModeToggle } from "@/components/mode-toggle";
import { StockDrawer } from "@/components/stock-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getIndices,
  getRunAnalysisPartial,
  getRunAnalysisProgress,
  getRunAnalysisResultWithProgress,
  getStockDetails,
  runAnalysisWithProgress,
} from "@/lib/api";
import type {
  IndexInfo,
  RunAnalysisResponse,
  ScoreKey,
  StockDetailsResponse,
} from "@/lib/types";

const SCORE_OPTIONS: { key: ScoreKey; label: string }[] = [
  { key: "score_1", label: "last_close / avg(last_5_day_close)" },
  { key: "score_2", label: "last_close / prev_day_close" },
  { key: "score_3", label: "last_close / avg(all_emas)" },
];

const FALLBACK_INDICES: IndexInfo[] = [
  { name: "sp500", label: "S&P 500" },
  { name: "nasdaq100", label: "NASDAQ 100" },
  { name: "dow30", label: "Dow 30" },
  { name: "nifty50", label: "Nifty 50" },
  { name: "niftynext50", label: "Nifty Next 50" },
];

const ALL_VALUE = "__all__";

export default function Home() {
  const [indices, setIndices] = React.useState<IndexInfo[]>([]);
  const [indexName, setIndexName] = React.useState<string>("sp500");
  const [selectedScore, setSelectedScore] = React.useState<ScoreKey>("score_1");
  const [search, setSearch] = React.useState("");
  const [sectorFilter, setSectorFilter] = React.useState(ALL_VALUE);
  const [subSectorFilter, setSubSectorFilter] = React.useState(ALL_VALUE);

  const [loading, setLoading] = React.useState(false);
  const [runProgress, setRunProgress] = React.useState<{
    runId: string;
    status: "running" | "done" | "error" | null;
    processed: number;
    total: number;
    progressPercent: number | null;
    etaSeconds: number | null;
    message: string | null;
    error: string | null;
  } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resp, setResp] = React.useState<RunAnalysisResponse | null>(null);

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [detailsError, setDetailsError] = React.useState<string | null>(null);
  const [details, setDetails] = React.useState<StockDetailsResponse | null>(
    null
  );

  React.useEffect(() => {
    getIndices()
      .then((d) => setIndices(d))
      .catch(() => {
        setIndices(FALLBACK_INDICES);
        setError("Backend API is not reachable. Start the backend to run analysis.");
      });
  }, []);

  React.useEffect(() => {
    if (!indices.length) return;
    if (!indices.some((i) => i.name === indexName)) {
      setIndexName(indices[0]!.name);
    }
  }, [indices, indexName]);

  const sectors = React.useMemo(() => {
    if (!resp) return [];
    const set = new Set<string>();
    resp.rows.forEach((r) => {
      if (r.sector) set.add(r.sector);
    });
    return Array.from(set).sort();
  }, [resp]);

  const subSectors = React.useMemo(() => {
    if (!resp) return [];
    const set = new Set<string>();
    resp.rows.forEach((r) => {
      if (r.sub_sector) {
        if (sectorFilter === ALL_VALUE || r.sector === sectorFilter) {
          set.add(r.sub_sector);
        }
      }
    });
    return Array.from(set).sort();
  }, [resp, sectorFilter]);

  React.useEffect(() => {
    setSubSectorFilter(ALL_VALUE);
  }, [sectorFilter]);

  async function onRun(refresh: boolean) {
    setError(null);
    setLoading(true);
    setResp(null);
    setRunProgress(null);
    setSectorFilter(ALL_VALUE);
    setSubSectorFilter(ALL_VALUE);

    try {
      const started = await runAnalysisWithProgress({
        index_name: indexName,
        selected_score: selectedScore,
        refresh_data: refresh,
      });

      if (started.mode === "cached" && started.result) {
        setResp(started.result);
        setRunProgress({
          runId: started.run_id,
          status: "done",
          processed: started.result.rows.length,
          total: started.result.rows.length,
          progressPercent: 100,
          etaSeconds: null,
          message: "Cached",
          error: null,
        });
        return;
      }

      const runId = started.run_id;
      setRunProgress({
        runId,
        status: "running",
        processed: 0,
        total: 0,
        progressPercent: null,
        etaSeconds: null,
        message: "Starting…",
        error: null,
      });

      let lastRowCount = 0;
      while (true) {
        const [p, partial] = await Promise.all([
          getRunAnalysisProgress(runId),
          getRunAnalysisPartial(runId),
        ]);

        setRunProgress({
          runId: p.run_id,
          status: p.status,
          processed: p.processed,
          total: p.total,
          progressPercent: p.progress_percent,
          etaSeconds: p.eta_seconds,
          message: p.message,
          error: p.error,
        });

        if (partial && partial.rows && partial.rows.length > lastRowCount) {
          lastRowCount = partial.rows.length;
          setResp(partial);
        }

        if (p.status === "done") {
          const finalResult = await getRunAnalysisResultWithProgress(runId);
          setResp(finalResult);
          break;
        }

        if (p.status === "error") {
          throw new Error(p.error || "Analysis failed");
        }

        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to run analysis");
    } finally {
      setLoading(false);
    }
  }

  async function onRowClick(row: { symbol: string }) {
    setDrawerOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetails(null);
    try {
      const d = await getStockDetails(row.symbol);
      setDetails(d);
    } catch (e: unknown) {
      setDetailsError(e instanceof Error ? e.message : "Failed to load stock details");
    } finally {
      setDetailsLoading(false);
    }
  }

  const filtered = resp
    ? {
        ...resp,
        rows: resp.rows.filter((r) => {
          const q = search.toLowerCase().trim();
          if (q) {
            const match =
              (r.symbol || "").toLowerCase().includes(q) ||
              (r.name || "").toLowerCase().includes(q);
            if (!match) return false;
          }
          if (sectorFilter !== ALL_VALUE && r.sector !== sectorFilter) return false;
          if (subSectorFilter !== ALL_VALUE && r.sub_sector !== subSectorFilter) return false;
          return true;
        }),
      }
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1400px] px-4 py-6">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight">
              Equity Analysis Dashboard
            </div>
            <div className="text-sm text-muted-foreground">
              Index scoring + trend states + Fibonacci levels
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
          </div>
        </div>

        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Row 1: Index, Score, Search, Buttons */}
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <div className="mb-1 text-xs text-muted-foreground">Index</div>
                <Select
                  value={indexName}
                  onValueChange={setIndexName}
                  disabled={!indices.length}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select index" />
                  </SelectTrigger>
                  <SelectContent>
                    {indices.map((i) => (
                      <SelectItem key={i.name} value={i.name}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-5">
                <div className="mb-1 text-xs text-muted-foreground">
                  Selected score (drives BUY/HOLD/SELL)
                </div>
                <Select
                  value={selectedScore}
                  onValueChange={(v) => setSelectedScore(v as ScoreKey)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select score" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCORE_OPTIONS.map((s) => (
                      <SelectItem key={s.key} value={s.key}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="md:col-span-2">
                <div className="mb-1 text-xs text-muted-foreground">Search</div>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="AAPL / Reliance…"
                />
              </div>

              <div className="md:col-span-2 flex items-end gap-2">
                <Button onClick={() => onRun(false)} disabled={loading}>
                  {loading ? "Running…" : "Run"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onRun(true)}
                  disabled={loading}
                >
                  Refresh
                </Button>
              </div>
            </div>

            {/* Row 2: Sector + Sub-sector filters (visible when data is loaded) */}
            {sectors.length > 0 && (
              <div className="mt-3 grid gap-3 md:grid-cols-12">
                <div className="md:col-span-3">
                  <div className="mb-1 text-xs text-muted-foreground">Sector</div>
                  <Select value={sectorFilter} onValueChange={setSectorFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All sectors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All Sectors</SelectItem>
                      {sectors.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="md:col-span-3">
                  <div className="mb-1 text-xs text-muted-foreground">Sub-sector</div>
                  <Select value={subSectorFilter} onValueChange={setSubSectorFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="All sub-sectors" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_VALUE}>All Sub-sectors</SelectItem>
                      {subSectors.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {(sectorFilter !== ALL_VALUE || subSectorFilter !== ALL_VALUE) && (
                  <div className="md:col-span-2 flex items-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setSectorFilter(ALL_VALUE);
                        setSubSectorFilter(ALL_VALUE);
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                )}
              </div>
            )}

            {error ? (
              <div className="mt-3 text-sm text-destructive">{error}</div>
            ) : null}

            {runProgress && runProgress.status === "running" ? (
              <div className="mt-4 rounded-xl border bg-card p-4">
                <div className="text-sm font-semibold">Processing…</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {runProgress.message ?? "Working"}{" "}
                  {runProgress.total > 0 ? (
                    <>
                      ({runProgress.processed}/{runProgress.total})
                    </>
                  ) : null}
                </div>
                <div className="mt-2 text-sm">
                  {runProgress.progressPercent === null
                    ? "Progress: —"
                    : `Progress: ${runProgress.progressPercent.toFixed(1)}%`}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {runProgress.etaSeconds === null
                    ? "ETA: —"
                    : `ETA: ~${Math.max(0, Math.round(runProgress.etaSeconds))}s`}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {resp ? (
          <div className="mb-6 grid gap-3 md:grid-cols-6">
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Total scanned</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {resp.summary.total}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">BUY</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {resp.summary.buy}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">HOLD</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {resp.summary.hold}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">SELL</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  {resp.summary.sell}
                </div>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground">Last updated</div>
                <div className="mt-1 text-sm">
                  {new Date(resp.cached_at).toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Index: {resp.metadata.index_name} · Score: {resp.metadata.selected_score}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {filtered ? (
          <AnalysisTable data={filtered} onRowClick={onRowClick} />
        ) : (
          <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">
            Select an index and score formula, then click <span className="font-medium">Run</span>.
          </div>
        )}
      </div>

      <StockDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        loading={detailsLoading}
        error={detailsError}
        data={details}
      />
    </div>
  );
}
