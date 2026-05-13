"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TestDataBadge } from "@/components/test-data-badge";
import { listPortfolios, deletePortfolio, duplicatePortfolio } from "@/lib/api";
import type { PortfolioListItem } from "@/lib/types";

function shorthand(p: PortfolioListItem) {
  return `Top ${p.momentum_screen_size} → Top ${p.final_portfolio_size}`;
}

export default function PortfoliosLibraryPage() {
  const router = useRouter();
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<PortfolioListItem[]>([]);
  const [q, setQ] = React.useState("");

  async function refresh() {
    setError(null);
    setLoading(true);
    try {
      const d = await listPortfolios();
      setItems(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load portfolios");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((p) => {
      const hay = `${p.name} ${p.universe} ${p.strategy}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q]);

  async function onDelete(id: string) {
    if (!confirm("Delete this portfolio? This cannot be undone.")) return;
    try {
      await deletePortfolio(id);
      await refresh();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function onDuplicate(id: string) {
    try {
      const created = await duplicatePortfolio(id);
      await refresh();
      router.push(`/portfolios/${created.id}/settings`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Duplicate failed");
    }
  }

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="text-2xl font-semibold tracking-tight text-foreground">Portfolios</div>
          <div className="text-sm text-muted-foreground">
            Create and manage MomentumIQ portfolios. Strategy computation ships in the next phases.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/portfolios/new">New Portfolio</Link>
          </Button>
        </div>
      </div>

      <Card className="mb-4 shadow-sm">
        <CardContent className="p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Input
              className="h-8 w-full sm:max-w-sm text-xs"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search portfolios…"
              aria-label="Search portfolios"
            />
            <div className="flex items-center gap-2">
              <Button
                className="h-8 px-3 text-xs"
                variant="outline"
                onClick={refresh}
                disabled={loading}
              >
                {loading ? "Loading…" : "Refresh"}
              </Button>
              <Button
                className="h-8 px-3 text-xs"
                variant="outline"
                disabled
                title="Select a portfolio row to run, or use the Run button inside a portfolio."
              >
                Run Rebalance
              </Button>
            </div>
          </div>
          {error ? (
            <div className="mt-2 truncate text-xs font-medium text-destructive" title={error}>
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {loading ? (
        <div className="rounded-xl border bg-card p-10 text-center text-base text-muted-foreground">
          Loading portfolios…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-base text-muted-foreground leading-relaxed max-w-xl mx-auto">
          <div className="text-lg font-semibold text-foreground">Create your first portfolio</div>
          <div className="mt-2">
            MomentumIQ portfolios will track monthly snapshots, analytics, and history once the strategy engine ships.
          </div>
          <div className="mt-5">
            <Button asChild>
              <Link href="/portfolios/new">New Portfolio</Link>
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center text-base text-muted-foreground">
          No portfolios match your search.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((p) => (
            <Card key={p.id} className="shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-base font-semibold text-foreground">{p.name}</div>
                      {p.is_test_mode ? <TestDataBadge /> : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {p.strategy} · {p.universe} · {shorthand(p)}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Holdings: <span className="font-medium text-foreground">{p.holdings_count}</span> · Last run:{" "}
                      <span className="font-medium text-foreground">
                        {p.last_run_at ? new Date(p.last_run_at).toLocaleDateString() : "—"}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button asChild className="h-8 px-3 text-xs">
                    <Link href={`/portfolios/${p.id}/holdings`}>Open</Link>
                  </Button>
                  <Button
                    className="h-8 px-3 text-xs"
                    variant="outline"
                    onClick={() => router.push(`/portfolios/${p.id}/holdings?run=1`)}
                  >
                    Run Rebalance
                  </Button>
                  <Button
                    className="h-8 px-3 text-xs"
                    variant="outline"
                    onClick={() => onDuplicate(p.id)}
                  >
                    Duplicate
                  </Button>
                  <Button
                    className="h-8 px-3 text-xs"
                    variant="destructive"
                    onClick={() => onDelete(p.id)}
                  >
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

