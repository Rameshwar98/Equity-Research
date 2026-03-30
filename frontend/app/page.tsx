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

/** Placeholder matching control row layout — avoids SSR/client hydration fights (Radix IDs, extension-injected attrs). */
function ControlsSkeleton() {
  return (
    <div
      className="grid gap-3 md:grid-cols-12"
      aria-busy="true"
      aria-label="Loading controls"
    >
      <div className="md:col-span-3 space-y-1">
        <div className="h-3 w-10 rounded bg-muted" />
        <div className="h-9 w-full rounded-md bg-muted/50" />
      </div>
      <div className="md:col-span-5 space-y-1">
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="h-9 w-full rounded-md bg-muted/50" />
      </div>
      <div className="md:col-span-2 space-y-1">
        <div className="h-3 w-14 rounded bg-muted" />
        <div className="h-9 w-full rounded-md bg-muted/50" />
      </div>
      <div className="md:col-span-2 flex items-end gap-2">
        <div className="h-9 flex-1 rounded-md bg-muted/50" />
        <div className="h-9 flex-1 rounded-md bg-muted/50" />
      </div>
    </div>
  );
}

export default function Home() {
  const [controlsMounted, setControlsMounted] = React.useState(false);
  React.useEffect(() => {
    setControlsMounted(true);
  }, []);

  const [indices, setIndices] = React.useState<IndexInfo[]>([]);
  const [indexName, setIndexName] = React.useState<string>("sp500");
  const [selectedScore, setSelectedScore] = React.useState<ScoreKey>("score_3");
  const [search, setSearch] = React.useState("");
  const [sectorFilter, setSectorFilter] = React.useState(ALL_VALUE);
  const [subSectorFilter, setSubSectorFilter] = React.useState(ALL_VALUE);
  const [signalFilter, setSignalFilter] = React.useState(ALL_VALUE);

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
    setSignalFilter(ALL_VALUE);

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
      const d = await getStockDetails(row.symbol, selectedScore);
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
          if (signalFilter !== ALL_VALUE) {
            const latestSignal = r.signals?.[0];
            if (latestSignal !== signalFilter) return false;
          }
          return true;
        }),
      }
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[1480px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-3xl font-semibold tracking-tight text-foreground">
              Equity Analysis Dashboard
            </div>
            <div className="text-base text-muted-foreground leading-snug max-w-xl">
              Index scoring, trend states, and Fibonacci levels for universe screening.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ModeToggle />
          </div>
        </div>

        <Card className="mb-8 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {!controlsMounted ? (
              <ControlsSkeleton />
            ) : (
              <div className="grid gap-4 md:grid-cols-12 md:gap-x-4 md:gap-y-4">
                <div className="md:col-span-3">
                  <div className="mb-1.5 text-sm font-medium text-muted-foreground">Index</div>
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
                  <div className="mb-1.5 text-sm font-medium text-muted-foreground leading-snug">
                    Score formula <span className="font-normal text-muted-foreground/80">(drives signals)</span>
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
                  <div className="mb-1.5 text-sm font-medium text-muted-foreground">Search</div>
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
            )}

            {error ? (
              <div className="mt-4 text-sm font-medium text-destructive">{error}</div>
            ) : null}

            {runProgress && runProgress.status === "running" ? (
              <div className="mt-5 rounded-xl border bg-card p-5">
                <div className="text-base font-semibold">Processing…</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {runProgress.message ?? "Working"}{" "}
                  {runProgress.total > 0 ? (
                    <>
                      ({runProgress.processed}/{runProgress.total})
                    </>
                  ) : null}
                </div>
                <div className="mt-2 text-base tabular-nums">
                  {runProgress.progressPercent === null
                    ? "Progress: —"
                    : `Progress: ${runProgress.progressPercent.toFixed(1)}%`}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {runProgress.etaSeconds === null
                    ? "ETA: —"
                    : `ETA: ~${Math.max(0, Math.round(runProgress.etaSeconds))}s`}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {resp ? (
          <div className="mb-8 grid gap-4 sm:grid-cols-2 md:grid-cols-6">
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-medium text-muted-foreground">Total scanned</div>
                <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight">
                  {resp.summary.total}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-medium text-muted-foreground">BUY</div>
                <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                  {resp.summary.buy}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-medium text-muted-foreground">HOLD</div>
                <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-amber-700 dark:text-amber-400">
                  {resp.summary.hold}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <div className="text-sm font-medium text-muted-foreground">SELL</div>
                <div className="mt-1.5 text-3xl font-semibold tabular-nums tracking-tight text-rose-700 dark:text-rose-400">
                  {resp.summary.sell}
                </div>
              </CardContent>
            </Card>
            <Card className="md:col-span-2">
              <CardContent className="p-5">
                <div className="text-sm font-medium text-muted-foreground">Last updated</div>
                <div className="mt-1.5 text-base tabular-nums">
                  {new Date(resp.cached_at).toLocaleString("en-US", {
                    timeZone: "UTC",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  UTC
                </div>
                <div className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  Index: {resp.metadata.index_name} · Score: {resp.metadata.selected_score}
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {resp && resp.rows.length === 0 ? (
          <div
            className="mb-8 rounded-xl border border-amber-500/40 bg-amber-50/80 dark:bg-amber-950/25 px-5 py-4 text-sm text-foreground leading-relaxed"
            role="status"
          >
            <p className="font-semibold text-amber-950 dark:text-amber-100">
              Run finished, but no stocks were scored (0 rows).
            </p>
            <p className="mt-2 text-amber-900/90 dark:text-amber-200/90">
              The backend processed your index but every symbol was skipped—usually because{" "}
              <strong>no price history loaded</strong> (missing or invalid FMP API key, rate limits, network, or empty
              provider responses). Check the backend terminal logs, confirm{" "}
              <code className="rounded bg-amber-100/80 dark:bg-amber-900/40 px-1 py-0.5 text-xs">
                FMP_API_KEY
              </code>{" "}
              in <code className="rounded bg-amber-100/80 dark:bg-amber-900/40 px-1 py-0.5 text-xs">backend/.env</code>,
              then click <strong>Refresh</strong> to pull data again.
            </p>
          </div>
        ) : null}

        {filtered && resp && resp.rows.length > 0 && filtered.rows.length === 0 ? (
          <div
            className="mb-8 rounded-xl border border-border bg-muted/40 px-5 py-4 text-sm text-foreground"
            role="status"
          >
            <p className="font-semibold">No rows match your filters or search.</p>
            <p className="mt-1 text-muted-foreground">
              Clear the table search, set sectors and signals to “All”, or widen the search term.
            </p>
          </div>
        ) : null}

        {filtered ? (
          <AnalysisTable
            data={filtered}
            onRowClick={onRowClick}
            sectors={sectors}
            subSectors={subSectors}
            sectorFilter={sectorFilter}
            subSectorFilter={subSectorFilter}
            onSectorChange={setSectorFilter}
            onSubSectorChange={setSubSectorFilter}
            signalFilter={signalFilter}
            onSignalChange={setSignalFilter}
            allValue={ALL_VALUE}
          />
        ) : (
          <div className="rounded-xl border bg-card p-10 text-center text-base text-muted-foreground leading-relaxed max-w-lg mx-auto">
            Select an index and score formula, then click <span className="font-semibold text-foreground">Run</span>{" "}
            to load the universe.
          </div>
        )}
      </div>

      <StockDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        loading={detailsLoading}
        error={detailsError}
        data={details}
        selectedScore={selectedScore}
        indexName={indexName}
      />
    </div>
  );
}
