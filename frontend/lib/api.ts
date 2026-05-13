import type {
  Constituent,
  IndexInfo,
  PeersResponse,
  HoldingsView,
  MomentumPreview,
  MomentumSnapshot,
  PortfolioAnalyticsResponse,
  PortfolioHistoryResponse,
  PortfolioScheduleResponse,
  Portfolio,
  PortfolioListItem,
  GenerateTestHistoryResponse,
  RunAnalysisResponse,
  ScoreKey,
  StockDetailsResponse,
  StockNewsResponse,
} from "@/lib/types";

const DEFAULT_LOCAL_API = "http://127.0.0.1:8000";

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Avoid `localhost` in API URLs in the browser: it may resolve to ::1 while uvicorn listens on 127.0.0.1 only. */
function preferLoopbackApiBase(base: string): string {
  try {
    const u = new URL(base.endsWith("/") ? base.slice(0, -1) : base);
    if (u.hostname === "localhost" || u.hostname === "[::1]" || u.hostname === "::1") {
      u.hostname = "127.0.0.1";
      return u.origin;
    }
  } catch {
    /* keep */
  }
  return base.replace(/\/+$/, "");
}

/**
 * Build the URL for `fetch`.
 *
 * Browser local dev: call FastAPI **directly** on DEFAULT_LOCAL_API (or NEXT_PUBLIC when set),
 * not same-origin `/api` + Next rewrites — those rewrites often return 500 on Windows/WSL when
 * the Node proxy cannot reach 127.0.0.1:8000. CORS already allows localhost:3000 and 127.0.0.1:3000.
 *
 * Production: set `NEXT_PUBLIC_API_BASE_URL` to your deployed API origin.
 */
function joinApiUrl(path: string): string {
  const isBrowser = typeof window !== "undefined";
  let base = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");

  if (isBrowser) {
    if (!base) {
      base = DEFAULT_LOCAL_API;
    } else {
      try {
        const apiUrl = new URL(base);
        const pageHost = window.location.hostname;
        const pagePort = window.location.port || (window.location.protocol === "https:" ? "443" : "80");
        const apiHost = apiUrl.hostname;
        const apiPort = apiUrl.port || (apiUrl.protocol === "https:" ? "443" : "80");
        const sameMachine =
          (isLocalHost(apiHost) && isLocalHost(pageHost)) || apiHost === pageHost;
        const differentPort = String(apiPort) !== String(pagePort);

        if (sameMachine && differentPort) {
          // e.g. page :3000, API :8000 — keep absolute URL, direct to uvicorn
        } else if (isLocalHost(apiHost)) {
          // Same port or odd local combo: fall back to Next `/api` rewrite
          base = "";
        }
        // else: remote API host — keep `base`
      } catch {
        base = DEFAULT_LOCAL_API;
      }
    }
  } else if (!base) {
    base = DEFAULT_LOCAL_API;
  }

  if (base === "") {
    return path;
  }
  if (isBrowser) {
    base = preferLoopbackApiBase(base);
  }
  if (path.startsWith("/api/")) {
    const lower = base.toLowerCase();
    if (lower.endsWith("/api")) {
      return `${base.slice(0, -"/api".length)}${path}`;
    }
  }
  return `${base}${path}`;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const url = joinApiUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (typeof window !== "undefined" && (msg === "Failed to fetch" || msg.includes("NetworkError"))) {
      throw new Error(
        `Failed to fetch ${url} — start the API (uvicorn on :8000), or use NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 if localhost resolves to IPv6 but the server is IPv4-only.`
      );
    }
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let msg = text || `Request failed: ${res.status}`;
    try {
      const j = JSON.parse(text) as { detail?: string | { msg?: string }[] };
      if (typeof j?.detail === "string") {
        msg = j.detail;
      } else if (Array.isArray(j?.detail)) {
        msg = j.detail.map((e) => (typeof e === "object" && e && "msg" in e ? String(e.msg) : String(e))).join("; ");
      }
    } catch {
      /* keep msg */
    }
    const where = url.startsWith("http") ? url : `${typeof window !== "undefined" ? window.location.origin : ""}${url}`;
    let hint = "";
    if (
      res.status === 500 &&
      typeof window !== "undefined" &&
      !url.startsWith("http") &&
      (msg.includes("Internal Server Error") || msg.includes("<!DOCTYPE"))
    ) {
      hint =
        " — Next dev proxy: ensure uvicorn is running on the host/port in frontend/.env.local BACKEND_URL (default http://127.0.0.1:8000). If npm runs in WSL but the API runs on Windows, 127.0.0.1 is the wrong machine; set BACKEND_URL to your Windows host IP.";
    }
    throw new Error(`${msg} (${res.status}) — ${where}${hint}`);
  }
  return (await res.json()) as T;
}

export function getIndices() {
  return http<IndexInfo[]>("/api/indices");
}

export function getConstituents(indexName: string) {
  return http<Constituent[]>(`/api/index/${encodeURIComponent(indexName)}/constituents`);
}

export function runAnalysis(params: {
  index_name: string;
  selected_score: ScoreKey;
  refresh_data: boolean;
}) {
  return http<RunAnalysisResponse>("/api/run-analysis", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function runAnalysisWithProgress(params: {
  index_name: string;
  selected_score: ScoreKey;
  refresh_data: boolean;
}) {
  return http<{
    mode: "cached" | "run";
    run_id: string;
    result?: RunAnalysisResponse;
  }>("/api/run-analysis-with-progress", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getRunAnalysisProgress(runId: string) {
  return http<{
    run_id: string;
    status: "running" | "done" | "error";
    processed: number;
    total: number;
    progress_percent: number | null;
    eta_seconds: number | null;
    message: string | null;
    error: string | null;
  }>(`/api/run-analysis-with-progress/${encodeURIComponent(runId)}`);
}

export function getRunAnalysisResultWithProgress(runId: string) {
  return http<RunAnalysisResponse>(
    `/api/run-analysis-result-with-progress/${encodeURIComponent(runId)}`
  );
}

export function getRunAnalysisPartial(runId: string) {
  return http<RunAnalysisResponse>(
    `/api/run-analysis-partial/${encodeURIComponent(runId)}`
  );
}

export function getStockDetails(symbol: string, selectedScore?: string) {
  const params = selectedScore ? `?selected_score=${selectedScore}` : "";
  return http<StockDetailsResponse>(`/api/stock/${encodeURIComponent(symbol)}/details${params}`);
}

export function getStockPeers(symbol: string, indexName: string, selectedScore: ScoreKey) {
  const q = new URLSearchParams({
    index_name: indexName,
    selected_score: selectedScore,
  });
  return http<PeersResponse>(`/api/stock/${encodeURIComponent(symbol)}/peers?${q.toString()}`);
}

export function getStockNews(symbol: string, limit = 20) {
  const q = new URLSearchParams({ limit: String(limit) });
  return http<StockNewsResponse>(
    `/api/stock/${encodeURIComponent(symbol)}/news?${q.toString()}`
  );
}

export function listPortfolios() {
  return http<PortfolioListItem[]>("/api/portfolios");
}

export function createPortfolio(body: {
  name: string;
  strategy: "MomentumIQ";
  params: {
    universe: string;
    universe_size_cap?: number | null;
    momentum_screen_size: number;
    final_portfolio_size: number;
    ma_exit_override: boolean;
    rebalance_mode: "manual" | "auto" | "both";
    benchmark?: string | null;
  };
}) {
  return http<Portfolio>("/api/portfolios", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getPortfolio(id: string) {
  return http<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}`);
}

export function updatePortfolio(
  id: string,
  patch: Partial<{
    name: string;
    params: Portfolio["params"];
  }>
) {
  return http<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deletePortfolio(id: string) {
  return http<{ ok: true }>(`/api/portfolios/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function duplicatePortfolio(id: string) {
  return http<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
  });
}

export function generatePortfolioTestHistory(portfolioId: string) {
  // Dedicated path under /api/test/... avoids some reverse proxies that mishandle
  // long /api/portfolios/{id}/... POST paths; joinApiUrl() still fixes /api/api/... bases.
  return http<GenerateTestHistoryResponse>(
    `/api/test/seed-portfolio/${encodeURIComponent(portfolioId)}`,
    { method: "POST" }
  );
}

export function updatePortfolioPrefs(id: string, chart_prefs: Record<string, boolean>) {
  return http<Portfolio>(`/api/portfolios/${encodeURIComponent(id)}/prefs`, {
    method: "PATCH",
    body: JSON.stringify({ chart_prefs }),
  });
}

export function getPortfolioAnalytics(portfolioId: string) {
  return http<PortfolioAnalyticsResponse>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/analytics`
  );
}

export function getPortfolioHistory(portfolioId: string) {
  return http<PortfolioHistoryResponse>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/history`
  );
}

export function getPortfolioSchedule(portfolioId: string) {
  return http<PortfolioScheduleResponse>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/schedule`
  );
}

export function getPortfolioPriceHistory(portfolioId: string) {
  return http<PortfolioPriceHistoryResponse>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/price-history`
  );
}

/** Rebuild `portfolio_entries` + daily series by replaying all committed snapshots (oldest first). */
export function replayPortfolioPriceTracking(portfolioId: string) {
  return http<{
    ok: boolean;
    portfolio_id: string;
    snapshots_replayed: number;
    entry_rows: number;
    daily_series_points: number;
  }>(`/api/portfolios/${encodeURIComponent(portfolioId)}/replay-price-tracking`, { method: "POST" });
}

export function startPortfolioRebalance(portfolioId: string) {
  return http<{ run_id: string }>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/rebalance-with-progress`,
    { method: "POST" }
  );
}

export function getPortfolioRebalanceProgress(portfolioId: string, runId: string) {
  return http<{
    run_id: string;
    status: "running" | "done" | "error";
    processed: number;
    total: number;
    progress_percent: number | null;
    eta_seconds: number | null;
    message: string | null;
    error: string | null;
  }>(
    `/api/portfolios/${encodeURIComponent(
      portfolioId
    )}/rebalance-with-progress/${encodeURIComponent(runId)}`
  );
}

export function getPortfolioRebalancePreview(portfolioId: string, runId: string) {
  return http<MomentumPreview>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/rebalance-preview/${encodeURIComponent(runId)}`
  );
}

export function commitPortfolioRebalance(portfolioId: string, runId: string) {
  return http<MomentumSnapshot>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/rebalance-commit/${encodeURIComponent(runId)}`,
    { method: "POST" }
  );
}

export function discardPortfolioRebalance(portfolioId: string, runId: string) {
  return http<{ ok: true }>(
    `/api/portfolios/${encodeURIComponent(portfolioId)}/rebalance-discard/${encodeURIComponent(runId)}`,
    { method: "POST" }
  );
}

export function getPortfolioHoldings(portfolioId: string) {
  return http<HoldingsView>(`/api/portfolios/${encodeURIComponent(portfolioId)}/holdings`);
}

