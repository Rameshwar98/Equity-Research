"use client";

import * as React from "react";

import { AnalysisTable } from "@/components/analysis-table";
import { ModeToggle } from "@/components/mode-toggle";
import { StockDrawer } from "@/components/stock-drawer";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectDivider,
  SelectGroup,
  SelectGroupLabel,
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
  { name: "nifty500", label: "Nifty 500" },
  { name: "global_indices", label: "Global indices" },
  { name: "commodities", label: "Commodities" },
  { name: "sector_indices", label: "Sector indices (GICS)" },
];

const ALL_VALUE = "__all__";

/** Backend `/indices` may lag deploys; keep dropdown entries the UI supports. */
function mergeIndicesWithFallback(api: IndexInfo[]): IndexInfo[] {
  const apiNames = new Set(api.map((i) => i.name));
  return [...api, ...FALLBACK_INDICES.filter((f) => !apiNames.has(f.name))];
}

/** Placeholder matching compact toolbar — avoids SSR/client hydration fights (Radix IDs, extension-injected attrs). */
function ControlsSkeleton() {
  return (
    <div
      className="flex flex-nowrap items-center gap-2 overflow-x-auto py-0.5"
      aria-busy="true"
      aria-label="Loading controls"
    >
      <div className="h-3 w-9 shrink-0 rounded bg-muted" />
      <div className="h-9 w-[132px] shrink-0 rounded-md bg-muted/50" />
      <div className="h-3 w-10 shrink-0 rounded bg-muted" />
      <div className="h-9 w-[200px] shrink-0 rounded-md bg-muted/50" />
      <div className="h-3 w-12 shrink-0 rounded bg-muted" />
      <div className="h-9 w-[128px] shrink-0 rounded-md bg-muted/50" />
      <div className="h-9 w-16 shrink-0 rounded-md bg-muted/50" />
      <div className="h-9 w-20 shrink-0 rounded-md bg-muted/50" />
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
      .then((d) => setIndices(mergeIndicesWithFallback(d)))
      .catch(() => {
        setIndices(FALLBACK_INDICES);
        setError("Backend API is not reachable. Start the backend to run analysis.");
      });
  }, []);

  const indicesByName = React.useMemo(() => {
    const m = new Map<string, IndexInfo>();
    indices.forEach((i) => m.set(i.name, i));
    return m;
  }, [indices]);

  const indexGroups = React.useMemo(() => {
    const pick = (names: string[]) =>
      names.map((n) => indicesByName.get(n)).filter(Boolean) as IndexInfo[];

    const remaining = new Map(indicesByName);
    const take = (names: string[]) => {
      const got = pick(names);
      names.forEach((n) => remaining.delete(n));
      return got;
    };

    const groups: { label: string; items: IndexInfo[] }[] = [
      { label: "US", items: take(["sp500", "nasdaq100", "dow30"]) },
      { label: "India", items: take(["nifty50", "niftynext50", "nifty500"]) },
      {
        label: "Global indices",
        items: take(["global_indices"]),
      },
      { label: "Commodities", items: take(["commodities"]) },
      { label: "Sectors", items: take(["sector_indices"]) },
    ].filter((g) => g.items.length > 0);

    // Anything else we didn't explicitly group (e.g. future additions).
    const leftovers = Array.from(remaining.values()).filter((i) => i.name !== "custom");
    leftovers.sort((a, b) => a.label.localeCompare(b.label));
    if (leftovers.length) groups.push({ label: "Other", items: leftovers });

    const custom = indicesByName.get("custom");
    if (custom) groups.push({ label: "Custom", items: [custom] });

    return groups;
  }, [indicesByName]);

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
      <div className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
        <div className="mb-4 flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
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

        <Card className="mb-4 shadow-sm">
          <CardContent className="p-3">
            {!controlsMounted ? (
              <ControlsSkeleton />
            ) : (
              <div
                className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                role="toolbar"
                aria-label="Analysis controls and summary"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 sm:flex-nowrap sm:overflow-x-auto sm:py-0.5 [scrollbar-width:thin]">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">Index</span>
                  <div className="w-[min(152px,42vw)] shrink-0">
                    <Select
                      value={indexName}
                      onValueChange={setIndexName}
                      disabled={!indices.length}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select index" />
                      </SelectTrigger>
                      <SelectContent>
                        {indexGroups.map((g, idx) => (
                          <React.Fragment key={g.label}>
                            {idx > 0 ? <SelectDivider /> : null}
                            <SelectGroup>
                              <SelectGroupLabel>{g.label}</SelectGroupLabel>
                              {g.items.map((i) => (
                                <SelectItem key={i.name} value={i.name}>
                                  {i.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </React.Fragment>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <span className="shrink-0 text-xs font-medium text-muted-foreground">Score</span>
                  <div className="min-w-[min(220px,55vw)] max-w-[min(320px,70vw)] shrink-0">
                    <Select
                      value={selectedScore}
                      onValueChange={(v) => setSelectedScore(v as ScoreKey)}
                    >
                      <SelectTrigger className="h-8 text-xs">
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

                  <Input
                    className="h-8 w-[min(140px,28vw)] shrink-0 text-xs"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search…"
                    aria-label="Search symbol or name"
                  />

                  <Button
                    className="h-8 shrink-0 px-3 text-xs"
                    onClick={() => onRun(false)}
                    disabled={loading}
                  >
                    {loading ? "Running…" : "Run"}
                  </Button>
                  <Button
                    className="h-8 shrink-0 px-3 text-xs"
                    variant="outline"
                    onClick={() => onRun(true)}
                    disabled={loading}
                  >
                    Refresh
                  </Button>
                </div>

                {runProgress && runProgress.status === "running" ? (
                  <div className="flex min-w-0 max-w-full items-center gap-2 border-t border-border pt-2 sm:min-w-[12rem] sm:border-t-0 sm:border-l sm:pl-3 sm:pt-0">
                    <div className="hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block sm:w-20">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-300"
                        style={{
                          width: `${Math.min(
                            100,
                            Math.max(0, runProgress.progressPercent ?? 0)
                          )}%`,
                        }}
                      />
                    </div>
                    <span
                      className="min-w-0 truncate text-xs text-muted-foreground tabular-nums"
                      title={
                        [
                          runProgress.message ?? "Processing",
                          runProgress.total > 0
                            ? `${runProgress.processed}/${runProgress.total}`
                            : null,
                          runProgress.progressPercent !== null
                            ? `${runProgress.progressPercent.toFixed(1)}%`
                            : null,
                          runProgress.etaSeconds !== null
                            ? `~${Math.max(0, Math.round(runProgress.etaSeconds))}s`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      }
                    >
                      <span className="font-medium text-foreground">
                        {runProgress.message ?? "Processing"}
                      </span>
                      {runProgress.total > 0
                        ? ` (${runProgress.processed}/${runProgress.total})`
                        : null}
                      {runProgress.progressPercent === null
                        ? ""
                        : ` · ${runProgress.progressPercent.toFixed(1)}%`}
                      {runProgress.etaSeconds === null
                        ? ""
                        : ` · ~${Math.max(0, Math.round(runProgress.etaSeconds))}s`}
                    </span>
                  </div>
                ) : null}

                {resp && !(runProgress && runProgress.status === "running") ? (
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs tabular-nums sm:flex-nowrap sm:overflow-x-auto sm:border-t-0 sm:border-l sm:pl-3 sm:pt-0 [scrollbar-width:thin]">
                    <span className="shrink-0 text-muted-foreground">
                      Total{" "}
                      <span className="font-semibold text-foreground">{resp.summary.total}</span>
                    </span>
                    <span className="text-muted-foreground/50" aria-hidden>
                      ·
                    </span>
                    <span className="shrink-0 text-emerald-700 dark:text-emerald-400">
                      BUY <span className="font-semibold">{resp.summary.buy}</span>
                    </span>
                    <span className="text-muted-foreground/50" aria-hidden>
                      ·
                    </span>
                    <span className="shrink-0 text-amber-700 dark:text-amber-400">
                      HOLD <span className="font-semibold">{resp.summary.hold}</span>
                    </span>
                    <span className="text-muted-foreground/50" aria-hidden>
                      ·
                    </span>
                    <span className="shrink-0 text-rose-700 dark:text-rose-400">
                      SELL <span className="font-semibold">{resp.summary.sell}</span>
                    </span>
                    <span className="text-muted-foreground/50" aria-hidden>
                      ·
                    </span>
                    <span
                      className="min-w-0 shrink text-muted-foreground sm:shrink-0"
                      title={`${new Date(resp.cached_at).toLocaleString("en-US", {
                        timeZone: "UTC",
                        dateStyle: "medium",
                        timeStyle: "short",
                      })} UTC · ${resp.metadata.index_name} · ${resp.metadata.selected_score}`}
                    >
                      <span className="hidden lg:inline">Updated </span>
                      <span className="sm:whitespace-nowrap">
                        {new Date(resp.cached_at).toLocaleString("en-US", {
                          timeZone: "UTC",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        UTC · {resp.metadata.index_name} · {resp.metadata.selected_score}
                      </span>
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {error ? (
              <div
                className="mt-2 truncate text-xs font-medium text-destructive"
                title={error}
              >
                {error}
              </div>
            ) : null}
          </CardContent>
        </Card>

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
