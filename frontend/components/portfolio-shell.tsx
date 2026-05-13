"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TestDataBadge } from "@/components/test-data-badge";
import { getPortfolio, getPortfolioSchedule } from "@/lib/api";
import type { Portfolio } from "@/lib/types";

const TABS: { key: string; label: string }[] = [
  { key: "holdings", label: "Holdings" },
  { key: "analytics", label: "Analytics" },
  { key: "history", label: "History" },
  { key: "settings", label: "Settings" },
];

export function PortfolioShell({
  children,
  lastRebalanceAt,
  actions,
  status,
}: {
  children: React.ReactNode;
  lastRebalanceAt?: string | null;
  actions?: React.ReactNode;
  status?: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const id = params?.id;

  const [p, setP] = React.useState<Portfolio | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [nextAuto, setNextAuto] = React.useState<string | null>(null);

  const loadPortfolio = React.useCallback(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    getPortfolio(id)
      .then((d) => setP(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load portfolio"))
      .finally(() => setLoading(false));
  }, [id]);

  React.useEffect(() => {
    if (!id) return;
    setNextAuto(null);
    loadPortfolio();
    getPortfolioSchedule(id)
      .then((s) => {
        if (s.enabled) setNextAuto(s.next_auto_rebalance);
      })
      .catch(() => {
        // ignore; schedule is optional UI enhancement
      });
  }, [id, loadPortfolio]);

  React.useEffect(() => {
    if (!id) return;
    const onRefetch = () => loadPortfolio();
    window.addEventListener("portfolio-refetch", onRefetch);
    return () => window.removeEventListener("portfolio-refetch", onRefetch);
  }, [id, loadPortfolio]);

  const activeKey =
    TABS.find((t) => pathname === `/portfolios/${id}/${t.key}`)?.key || "holdings";

  return (
    <div className="mx-auto max-w-[1480px] px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
      <div className="mb-4">
        <Card className="shadow-sm">
          <CardContent className="p-2.5 sm:p-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <div className="truncate text-base font-semibold tracking-tight text-foreground">
                    {loading ? "Loading…" : p?.name || "Portfolio"}
                  </div>
                  {p?.is_test_mode ? <TestDataBadge /> : null}
                  {p ? (
                    <span className="inline-flex items-center rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[11px] text-muted-foreground">
                      {p.strategy} · {p.params.universe}
                    </span>
                  ) : null}
                  <span className="hidden md:inline text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">
                    Last rebalance:{" "}
                    <span className="font-medium text-foreground">
                      {lastRebalanceAt ? new Date(lastRebalanceAt).toLocaleString() : "—"}
                    </span>
                  </span>
                  <span className="hidden md:inline text-xs text-muted-foreground">·</span>
                  <span className="text-xs text-muted-foreground">
                    Next auto-rebalance: <span className="font-medium text-foreground">{nextAuto || "—"}</span>
                  </span>
                </div>
              </div>
              {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            </div>

            {error ? (
              <div className="mt-2 truncate text-xs font-medium text-destructive" title={error}>
                {error}
              </div>
            ) : null}

            {status ? <div className="mt-2 text-xs text-muted-foreground">{status}</div> : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {TABS.map((t) => (
                <Button
                  key={t.key}
                  asChild
                  variant={activeKey === t.key ? "default" : "outline"}
                  className="h-8 px-3 text-xs"
                >
                  <Link href={`/portfolios/${id}/${t.key}`}>{t.label}</Link>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {children}
    </div>
  );
}

