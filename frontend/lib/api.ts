import type {
  Constituent,
  IndexInfo,
  RunAnalysisResponse,
  ScoreKey,
  StockDetailsResponse,
} from "@/lib/types";

const baseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ||
  "http://localhost:8000";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status}`);
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

export function getStockDetails(symbol: string) {
  return http<StockDetailsResponse>(`/api/stock/${encodeURIComponent(symbol)}/details`);
}

