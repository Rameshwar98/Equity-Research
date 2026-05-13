export type BenchmarkSuggestion = {
  symbol: string;
  label: string;
};

/**
 * Suggested benchmark symbols by universe.
 * Keep these as FMP-compatible tickers where possible.
 */
const SUGGESTIONS: Record<string, BenchmarkSuggestion[]> = {
  sp500: [
    { symbol: "SPY", label: "SPY (S&P 500 ETF)" },
    { symbol: "VOO", label: "VOO (S&P 500 ETF)" },
    { symbol: "IVV", label: "IVV (S&P 500 ETF)" },
  ],
  nifty50: [
    { symbol: "NIFTYBEES.NS", label: "NIFTYBEES (Nifty 50 ETF)" },
    { symbol: "^NSEI", label: "^NSEI (Nifty 50 index)" },
  ],
  nasdaq100: [
    { symbol: "QQQ", label: "QQQ (Nasdaq 100 ETF)" },
    { symbol: "QQQM", label: "QQQM (Nasdaq 100 ETF)" },
  ],
};

export function getBenchmarkSuggestions(universe: string): BenchmarkSuggestion[] {
  const key = (universe || "").toLowerCase().trim();
  return SUGGESTIONS[key] || [{ symbol: "SPY", label: "SPY (S&P 500 ETF)" }];
}

