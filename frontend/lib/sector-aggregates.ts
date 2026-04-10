import type { AnalysisRow, Signal } from "@/lib/types";

export type SectorAggregateRow = {
  sector: string;
  stockCount: number;
  sumMktCap: number;
  avgReturn1d: number | null;
  avgReturn1w: number | null;
  avgReturn1m: number | null;
  avgReturn3m: number | null;
  avgReturnYtd: number | null;
  buyCount: number;
  holdCount: number;
  sellCount: number;
};

/** Universe-wide totals for the same row set as sector breakdown (not averages of sector rows). */
export type SectorPortfolioTotals = {
  stockCount: number;
  sumMktCap: number;
  avgReturn1d: number | null;
  avgReturn1w: number | null;
  avgReturn1m: number | null;
  avgReturn3m: number | null;
  avgReturnYtd: number | null;
  buyCount: number;
  holdCount: number;
  sellCount: number;
};

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function latestSignal(row: AnalysisRow): Signal {
  return (row.signals?.[0] as Signal | undefined) ?? "N/A";
}

/** Aggregate `rows` by `sector` (blank → "Unknown"). */
export function computeSectorAggregates(rows: AnalysisRow[]): SectorAggregateRow[] {
  const groups = new Map<
    string,
    {
      stockCount: number;
      caps: number[];
      r1d: number[];
      r1w: number[];
      r1m: number[];
      r3m: number[];
      rytd: number[];
      buy: number;
      hold: number;
      sell: number;
    }
  >();

  for (const row of rows) {
    const key = (row.sector && String(row.sector).trim()) || "Unknown";
    let g = groups.get(key);
    if (!g) {
      g = {
        stockCount: 0,
        caps: [],
        r1d: [],
        r1w: [],
        r1m: [],
        r3m: [],
        rytd: [],
        buy: 0,
        hold: 0,
        sell: 0,
      };
      groups.set(key, g);
    }
    g.stockCount += 1;
    if (row.mkt_cap != null && !Number.isNaN(row.mkt_cap)) {
      g.caps.push(row.mkt_cap);
    }
    if (row.return_1d != null && !Number.isNaN(row.return_1d)) g.r1d.push(row.return_1d);
    if (row.return_1w != null && !Number.isNaN(row.return_1w)) g.r1w.push(row.return_1w);
    if (row.return_1m != null && !Number.isNaN(row.return_1m)) g.r1m.push(row.return_1m);
    if (row.return_3m != null && !Number.isNaN(row.return_3m)) g.r3m.push(row.return_3m);
    if (row.return_ytd != null && !Number.isNaN(row.return_ytd)) g.rytd.push(row.return_ytd);

    const s = latestSignal(row);
    if (s === "BUY") g.buy += 1;
    else if (s === "HOLD") g.hold += 1;
    else if (s === "SELL") g.sell += 1;
  }

  const out: SectorAggregateRow[] = [];
  for (const [sector, g] of groups) {
    const sumMktCap = g.caps.reduce((a, b) => a + b, 0);
    out.push({
      sector,
      stockCount: g.stockCount,
      sumMktCap,
      avgReturn1d: mean(g.r1d),
      avgReturn1w: mean(g.r1w),
      avgReturn1m: mean(g.r1m),
      avgReturn3m: mean(g.r3m),
      avgReturnYtd: mean(g.rytd),
      buyCount: g.buy,
      holdCount: g.hold,
      sellCount: g.sell,
    });
  }

  out.sort((a, b) => a.sector.localeCompare(b.sector, undefined, { sensitivity: "base" }));
  return out;
}

/** Mean return across all stocks (same definition as per-sector “avg of ind stock rt”). */
export function computeSectorPortfolioTotals(rows: AnalysisRow[]): SectorPortfolioTotals {
  const caps: number[] = [];
  const r1d: number[] = [];
  const r1w: number[] = [];
  const r1m: number[] = [];
  const r3m: number[] = [];
  const rytd: number[] = [];
  let buy = 0;
  let hold = 0;
  let sell = 0;

  for (const row of rows) {
    if (row.mkt_cap != null && !Number.isNaN(row.mkt_cap)) caps.push(row.mkt_cap);
    if (row.return_1d != null && !Number.isNaN(row.return_1d)) r1d.push(row.return_1d);
    if (row.return_1w != null && !Number.isNaN(row.return_1w)) r1w.push(row.return_1w);
    if (row.return_1m != null && !Number.isNaN(row.return_1m)) r1m.push(row.return_1m);
    if (row.return_3m != null && !Number.isNaN(row.return_3m)) r3m.push(row.return_3m);
    if (row.return_ytd != null && !Number.isNaN(row.return_ytd)) rytd.push(row.return_ytd);
    const s = latestSignal(row);
    if (s === "BUY") buy += 1;
    else if (s === "HOLD") hold += 1;
    else if (s === "SELL") sell += 1;
  }

  return {
    stockCount: rows.length,
    sumMktCap: caps.reduce((a, b) => a + b, 0),
    avgReturn1d: mean(r1d),
    avgReturn1w: mean(r1w),
    avgReturn1m: mean(r1m),
    avgReturn3m: mean(r3m),
    avgReturnYtd: mean(rytd),
    buyCount: buy,
    holdCount: hold,
    sellCount: sell,
  };
}

export function signalCell(count: number, total: number): string {
  if (total <= 0) return "—";
  const pct = (count / total) * 100;
  return `${count}(${pct.toFixed(0)}%)`;
}
