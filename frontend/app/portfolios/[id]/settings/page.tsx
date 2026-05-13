"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";

import { PortfolioShell } from "@/components/portfolio-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TestDataBadge } from "@/components/test-data-badge";
import {
  deletePortfolio,
  generatePortfolioTestHistory,
  getIndices,
  getPortfolio,
  updatePortfolio,
} from "@/lib/api";
import { getBenchmarkSuggestions } from "@/lib/benchmarks";
import type { GenerateTestHistoryResponse, IndexInfo, Portfolio, RebalanceMode } from "@/lib/types";

export default function PortfolioSettingsPage() {
  const params = useParams<{ id: string | string[] | undefined }>();
  const router = useRouter();
  const rawId = params?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [testBusy, setTestBusy] = React.useState(false);
  const [testSummary, setTestSummary] = React.useState<GenerateTestHistoryResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [p, setP] = React.useState<Portfolio | null>(null);

  const [indices, setIndices] = React.useState<IndexInfo[]>([]);

  React.useEffect(() => {
    getIndices().then(setIndices).catch(() => setIndices([]));
  }, []);

  React.useEffect(() => {
    if (!id) {
      setLoading(false);
      setError("Missing portfolio id in URL.");
      return;
    }
    setLoading(true);
    setError(null);
    getPortfolio(id)
      .then((d) => setP(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load portfolio"))
      .finally(() => setLoading(false));
  }, [id]);

  const [name, setName] = React.useState("");
  const [universe, setUniverse] = React.useState("sp500");
  const [universeSizeCap, setUniverseSizeCap] = React.useState<string>("");
  const [momentumScreenSize, setMomentumScreenSize] = React.useState(100);
  const [finalSize, setFinalSize] = React.useState(25);
  const [maOverride, setMaOverride] = React.useState(true);
  const [rebalanceMode, setRebalanceMode] = React.useState<RebalanceMode>("manual");
  const [benchmark, setBenchmark] = React.useState("");

  const benchmarkSuggestions = React.useMemo(() => getBenchmarkSuggestions(universe), [universe]);

  React.useEffect(() => {
    if (!p) return;
    setName(p.name);
    setUniverse(p.params.universe);
    setUniverseSizeCap(p.params.universe_size_cap ? String(p.params.universe_size_cap) : "");
    setMomentumScreenSize(p.params.momentum_screen_size);
    setFinalSize(p.params.final_portfolio_size);
    setMaOverride(p.params.ma_exit_override);
    setRebalanceMode(p.params.rebalance_mode);
    setBenchmark(p.params.benchmark || "");
  }, [p]);

  const validation = React.useMemo(() => {
    const issues: string[] = [];
    if (!name.trim()) issues.push("Portfolio name is required.");
    if (!universe) issues.push("Universe is required.");
    if (finalSize > momentumScreenSize)
      issues.push("Final portfolio size must be ≤ momentum screen size.");

    const cap = universeSizeCap.trim() ? Number(universeSizeCap) : null;
    if (universeSizeCap.trim() && (!Number.isFinite(cap) || (cap as number) <= 0)) {
      issues.push("Universe size cap must be a positive number.");
    }
    return { ok: issues.length === 0, issues, cap };
  }, [name, universe, finalSize, momentumScreenSize, universeSizeCap]);

  async function onSave() {
    if (!id) return;
    setError(null);
    if (!validation.ok) {
      setError(validation.issues[0] || "Fix validation errors.");
      return;
    }
    setSaving(true);
    try {
      const next = await updatePortfolio(id, {
        name: name.trim(),
        params: {
          universe,
          universe_size_cap: validation.cap,
          momentum_screen_size: momentumScreenSize,
          final_portfolio_size: finalSize,
          ma_exit_override: maOverride,
          rebalance_mode: rebalanceMode,
          benchmark: benchmark.trim() ? benchmark.trim() : null,
        },
      });
      setP(next);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function onGenerateTestHistory() {
    if (!id) {
      setError("Missing portfolio id.");
      return;
    }
    setError(null);
    setTestSummary(null);
    setTestBusy(true);
    try {
      const res = await generatePortfolioTestHistory(id);
      setTestSummary(res);
      const next = await getPortfolio(id);
      setP(next);
      window.dispatchEvent(new Event("portfolio-refetch"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to generate test history");
    } finally {
      setTestBusy(false);
    }
  }

  async function onDelete() {
    if (!id) return;
    if (!confirm("Delete this portfolio? This cannot be undone.")) return;
    try {
      await deletePortfolio(id);
      router.push("/portfolios");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <PortfolioShell>
      <Card className="shadow-sm">
        <CardContent className="p-5 space-y-5">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-lg font-semibold text-foreground">Settings</div>
              {p?.is_test_mode ? <TestDataBadge /> : null}
            </div>
            <div className="text-sm text-muted-foreground">
              Changes apply on the next rebalance (strategy engine ships later).
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Portfolio name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label>Universe</Label>
              <Select value={universe} onValueChange={setUniverse} disabled={loading}>
                <SelectTrigger>
                  <SelectValue placeholder="Select universe" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectGroupLabel>Indices</SelectGroupLabel>
                    {indices.map((i) => (
                      <SelectItem key={i.name} value={i.name}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cap">Universe size cap (optional)</Label>
              <Input
                id="cap"
                value={universeSizeCap}
                onChange={(e) => setUniverseSizeCap(e.target.value)}
                disabled={loading}
                inputMode="numeric"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="benchmark">Benchmark (optional)</Label>
              <Input
                id="benchmark"
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value)}
                disabled={loading}
              />
              <div className="flex flex-wrap gap-2">
                {benchmarkSuggestions.map((s) => (
                  <Button
                    key={s.symbol}
                    type="button"
                    variant={benchmark.trim().toUpperCase() === s.symbol.toUpperCase() ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setBenchmark(s.symbol)}
                    disabled={loading}
                  >
                    {s.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={!benchmark.trim() ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setBenchmark("")}
                  disabled={loading}
                >
                  None
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="screen">Momentum screen size</Label>
              <Input
                id="screen"
                type="number"
                value={momentumScreenSize}
                onChange={(e) => setMomentumScreenSize(Number(e.target.value))}
                min={1}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="final">Final portfolio size</Label>
              <Input
                id="final"
                type="number"
                value={finalSize}
                onChange={(e) => setFinalSize(Number(e.target.value))}
                min={1}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label>Rebalance mode</Label>
              <Select
                value={rebalanceMode}
                onValueChange={(v) => setRebalanceMode(v as RebalanceMode)}
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual</SelectItem>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="both">Both</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
            <div className="text-sm font-medium text-foreground">UI test mode</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Wipes this portfolio&apos;s snapshots and price tracking, then creates 12 monthly snapshots from
              real historical prices and backfills a year of daily series. Use only for layout and chart previews —
              not for performance evaluation.
            </p>
            <Button
              type="button"
              variant="outline"
              className="border-amber-600/50 bg-amber-500/10 hover:bg-amber-500/20"
              onClick={onGenerateTestHistory}
              disabled={loading || testBusy}
            >
              {testBusy ? "Generating…" : "Generate test history"}
            </Button>
            {testSummary?.ok ? (
              <div
                className="rounded-md border border-green-600/30 bg-green-500/10 px-3 py-2 text-xs text-foreground"
                role="status"
              >
                <div className="font-medium text-green-900 dark:text-green-100">Test history ready</div>
                <ul className="mt-1 list-inside list-disc text-muted-foreground space-y-0.5">
                  <li>Snapshots created: {testSummary.snapshots_created}</li>
                  <li>Inception (tracking): {testSummary.inception_date ?? "—"}</li>
                  <li>Daily series points: {testSummary.daily_series_points}</li>
                </ul>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={maOverride}
                onChange={(e) => setMaOverride(e.target.checked)}
                disabled={loading}
              />
              50-MA exit override
            </label>
            <div className="flex items-center gap-2">
              <Button onClick={onSave} disabled={loading || saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
              <Button variant="destructive" onClick={onDelete} disabled={loading}>
                Delete portfolio
              </Button>
            </div>
          </div>

          {error ? (
            <div className="text-xs font-medium text-destructive" role="alert">
              {error}
            </div>
          ) : validation.ok ? null : (
            <div className="text-xs text-muted-foreground">{validation.issues[0]}</div>
          )}
        </CardContent>
      </Card>
    </PortfolioShell>
  );
}

