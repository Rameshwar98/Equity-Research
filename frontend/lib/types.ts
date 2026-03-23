export type Signal = "BUY" | "HOLD" | "SELL" | "N/A";
export type ScoreKey = "score_1" | "score_2" | "score_3";

export type IndexInfo = { name: string; label: string };
export type Constituent = { symbol: string; name?: string | null };

export type AnalysisRow = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  sub_sector?: string | null;
  score_1?: number | null;
  score_2?: number | null;
  score_3?: number | null;
  signals: Signal[];
};

export type RunAnalysisResponse = {
  metadata: {
    index_name: string;
    selected_score: ScoreKey;
    refresh_data: boolean;
  };
  date_labels: string[]; // len=16, most-recent first
  rows: AnalysisRow[];
  summary: { total: number; buy: number; hold: number; sell: number };
  cached_at: string;
};

export type StockDetailsResponse = {
  symbol: string;
  name?: string | null;
  date_labels: string[];
  signals: Signal[];
  closes?: (number | null)[];
  close?: number | null;
  scores: Record<ScoreKey, number | null>;
  emas: {
    ema_10?: number | null;
    ema_20?: number | null;
    ema_30?: number | null;
    ema_50?: number | null;
    ema_100?: number | null;
    ema_200?: number | null;
    avg_all_emas?: number | null;
  };
  fib: {
    high_52week?: number | null;
    low_52week?: number | null;
    px_last?: number | null;
    fib_61_8?: number | null;
    fib_50?: number | null;
    fib_38_2?: number | null;
    fib_23_6?: number | null;
  };
  fib_30d?: {
    high_30d?: number | null;
    low_30d?: number | null;
    px_last?: number | null;
    fib_61_8?: number | null;
    fib_50?: number | null;
    fib_38_2?: number | null;
    fib_23_6?: number | null;
  };
  chart_data?: {
    date: string;
    close: number | null;
    ema10?: number | null;
    ema20?: number | null;
    ema50?: number | null;
    signal?: string | null;
    volume?: number | null;
  }[];
  history?: { date: string; close: number; ema_10?: number; ema_20?: number }[];
};

