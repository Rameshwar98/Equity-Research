import type {
  HoldingsView,
  Portfolio,
  PortfolioAnalyticsResponse,
  PortfolioPriceHistoryResponse,
} from "@/lib/types";

/** In-memory bundle for the portfolio analytics page (per portfolio id). */
export type AnalyticsPageBundle = {
  portfolio: Portfolio;
  analytics: PortfolioAnalyticsResponse;
  holdingsView: HoldingsView;
  priceHistory: PortfolioPriceHistoryResponse;
  updatedAt: number;
};

const store = new Map<string, AnalyticsPageBundle>();
const MAX_ENTRIES = 12;

function evictIfNeeded(forKey: string) {
  if (store.size < MAX_ENTRIES || store.has(forKey)) return;
  let oldest: string | undefined;
  let oldestT = Infinity;
  for (const [k, v] of store) {
    if (v.updatedAt < oldestT) {
      oldestT = v.updatedAt;
      oldest = k;
    }
  }
  if (oldest) store.delete(oldest);
}

export function getAnalyticsPageBundle(portfolioId: string): AnalyticsPageBundle | undefined {
  return store.get(portfolioId);
}

export function setAnalyticsPageBundle(
  portfolioId: string,
  bundle: {
    portfolio: Portfolio;
    analytics: PortfolioAnalyticsResponse;
    holdingsView: HoldingsView;
    priceHistory: PortfolioPriceHistoryResponse;
  }
): void {
  evictIfNeeded(portfolioId);
  store.set(portfolioId, { ...bundle, updatedAt: Date.now() });
}

export function patchAnalyticsPageBundlePortfolio(portfolioId: string, portfolio: Portfolio): void {
  const cur = store.get(portfolioId);
  if (!cur) return;
  store.set(portfolioId, { ...cur, portfolio, updatedAt: Date.now() });
}

export function invalidateAnalyticsPageBundle(portfolioId: string): void {
  store.delete(portfolioId);
}
