"use client";

import * as React from "react";
import { getStockNews } from "@/lib/api";
import type { StockNewsItem } from "@/lib/types";

function fmtNewsDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length <= 10 ? "T12:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function StockNewsPanel({ symbol }: { symbol: string }) {
  const [items, setItems] = React.useState<StockNewsItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setItems([]);
    getStockNews(symbol, 25)
      .then((res) => {
        if (!cancelled) setItems(res.items ?? []);
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load news");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">Loading news…</div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground leading-relaxed">
        No news articles returned for this symbol. Coverage depends on your FMP plan and the ticker.
      </div>
    );
  }

  return (
    <div className="max-h-[min(70vh,780px)] overflow-y-auto pr-1 space-y-4">
      <p className="text-xs text-muted-foreground">
        Headlines from Financial Modeling Prep (newest first when provided by API).
      </p>
      <ul className="space-y-4 list-none p-0 m-0">
        {items.map((item, i) => (
          <li
            key={`${item.published_at ?? ""}-${item.title}-${i}`}
            className="rounded-lg border border-border/70 bg-card/50 px-3 py-2.5 shadow-sm"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {fmtNewsDate(item.published_at)}
              </span>
              {item.site ? (
                <span className="text-[11px] font-medium text-muted-foreground">{item.site}</span>
              ) : null}
            </div>
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-sm font-semibold text-primary hover:underline"
              >
                {item.title}
              </a>
            ) : (
              <div className="mt-1 text-sm font-semibold text-foreground">{item.title}</div>
            )}
            {item.text ? (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{item.text}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
