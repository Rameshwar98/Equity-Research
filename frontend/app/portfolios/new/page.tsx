"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

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
import { createPortfolio, getIndices } from "@/lib/api";
import { getBenchmarkSuggestions } from "@/lib/benchmarks";
import type { IndexInfo, RebalanceMode } from "@/lib/types";

const DEFAULTS = {
  universe_size_cap: "" as string,
  momentum_screen_size: 100,
  final_portfolio_size: 25,
  ma_exit_override: true,
  rebalance_mode: "manual" as RebalanceMode,
  benchmark: "",
};

export default function NewPortfolioPage() {
  const router = useRouter();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [indices, setIndices] = React.useState<IndexInfo[]>([]);
  const [indicesError, setIndicesError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [universe, setUniverse] = React.useState<string>("sp500");
  const [universeSizeCap, setUniverseSizeCap] = React.useState(DEFAULTS.universe_size_cap);
  const [momentumScreenSize, setMomentumScreenSize] = React.useState(DEFAULTS.momentum_screen_size);
  const [finalSize, setFinalSize] = React.useState(DEFAULTS.final_portfolio_size);
  const [maOverride, setMaOverride] = React.useState(DEFAULTS.ma_exit_override);
  const [rebalanceMode, setRebalanceMode] = React.useState<RebalanceMode>(DEFAULTS.rebalance_mode);
  const [benchmark, setBenchmark] = React.useState(DEFAULTS.benchmark);

  const benchmarkSuggestions = React.useMemo(() => getBenchmarkSuggestions(universe), [universe]);

  React.useEffect(() => {
    getIndices()
      .then((d) => setIndices(d))
      .catch(() => setIndicesError("Failed to load universes from backend."));
  }, []);

  const validation = React.useMemo(() => {
    const issues: string[] = [];
    if (!name.trim()) issues.push("Portfolio name is required.");
    if (!universe) issues.push("Universe is required.");
    if (finalSize > momentumScreenSize)
      issues.push("Final portfolio size must be ≤ momentum screen size.");
    if (momentumScreenSize <= 0 || finalSize <= 0) issues.push("Sizes must be positive.");

    const cap = universeSizeCap.trim() ? Number(universeSizeCap) : null;
    if (universeSizeCap.trim() && (!Number.isFinite(cap) || (cap as number) <= 0)) {
      issues.push("Universe size cap must be a positive number.");
    }
    return { ok: issues.length === 0, issues, cap };
  }, [name, universe, finalSize, momentumScreenSize, universeSizeCap]);

  async function onSave() {
    setError(null);
    if (!validation.ok) {
      setError(validation.issues[0] || "Fix validation errors.");
      return;
    }
    setSaving(true);
    try {
      await createPortfolio({
        name: name.trim(),
        strategy: "MomentumIQ",
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
      router.push("/portfolios");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save portfolio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[980px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mb-4 space-y-1">
        <div className="text-2xl font-semibold tracking-tight text-foreground">New Portfolio</div>
        <div className="text-sm text-muted-foreground">
          Set up a MomentumIQ portfolio. Save &amp; Run will be available once the strategy engine ships.
        </div>
      </div>

      <Card className="shadow-sm">
        <CardContent className="p-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Portfolio name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., MomentumIQ — S&P 500 Core"
              />
            </div>

            <div className="space-y-2">
              <Label>Universe</Label>
              <Select value={universe} onValueChange={setUniverse}>
                <SelectTrigger>
                  <SelectValue placeholder="Select universe" />
                </SelectTrigger>
                <SelectContent>
                  {indices.length ? (
                    <SelectGroup>
                      <SelectGroupLabel>Indices</SelectGroupLabel>
                      {indices.map((i) => (
                        <SelectItem key={i.name} value={i.name}>
                          {i.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : (
                    <SelectGroup>
                      <SelectGroupLabel>{indicesError || "Loading…"}</SelectGroupLabel>
                      <SelectItem value="sp500">S&amp;P 500</SelectItem>
                    </SelectGroup>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cap">Universe size cap (optional)</Label>
              <Input
                id="cap"
                value={universeSizeCap}
                onChange={(e) => setUniverseSizeCap(e.target.value)}
                placeholder="e.g., 500"
                inputMode="numeric"
              />
              <div className="text-xs text-muted-foreground">
                If set, keeps only the top N by market cap (applies in later phases).
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="benchmark">Benchmark (optional)</Label>
              <Input
                id="benchmark"
                value={benchmark}
                onChange={(e) => setBenchmark(e.target.value)}
                placeholder="e.g., SPY"
              />
              <div className="flex flex-wrap gap-2">
                {benchmarkSuggestions.map((s) => (
                  <Button
                    key={s.symbol}
                    type="button"
                    variant={benchmark.trim().toUpperCase() === s.symbol.toUpperCase() ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => setBenchmark(s.symbol)}
                  >
                    {s.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant={!benchmark.trim() ? "default" : "outline"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setBenchmark("")}
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
              />
            </div>
            <div className="space-y-2">
              <Label>Rebalance mode</Label>
              <Select value={rebalanceMode} onValueChange={(v) => setRebalanceMode(v as RebalanceMode)}>
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

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-t border-border pt-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={maOverride}
                onChange={(e) => setMaOverride(e.target.checked)}
              />
              50-MA exit override (default ON)
            </label>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => router.push("/portfolios")}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={onSave} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button disabled title="Available after the strategy engine ships.">
                Save &amp; Run
              </Button>
            </div>
          </div>

          {error ? (
            <div className="text-xs font-medium text-destructive" role="alert">
              {error}
            </div>
          ) : validation.ok ? null : (
            <div className="text-xs text-muted-foreground">
              {validation.issues[0]}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

