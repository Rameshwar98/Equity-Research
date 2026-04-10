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
  last_price?: number | null;
  /** YYYY-MM-DD — trading date of the EOD close shown as last_price */
  last_price_date?: string | null;
  mkt_cap?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  return_1d?: number | null;
  return_1w?: number | null;
  return_1m?: number | null;
  return_3m?: number | null;
  return_ytd?: number | null;
  signals: Signal[];
  /** ~52 weekly signals (1y), oldest → newest (Fri weeks) */
  signals_1y?: Signal[];
  signals_1y_dates?: string[];
  /** Legacy cached payloads (~26w) */
  signals_6m?: Signal[];
  signals_6m_dates?: string[];
};

export type RunAnalysisResponse = {
  metadata: {
    index_name: string;
    selected_score: ScoreKey;
    refresh_data: boolean;
  };
  date_labels: string[]; // up to 16 weeks, most-recent first
  rows: AnalysisRow[];
  summary: { total: number; buy: number; hold: number; sell: number };
  cached_at: string;
};

export type QuarterlyFinancialRow = {
  label: string;
  values: (number | null)[];
  format: "price" | "compact_currency" | "per_share" | "percent" | "ratio";
  /** Visual separator between metric groups */
  spacer?: boolean;
};

export type QuarterlyFinancials = {
  columns: string[];
  period_end_dates: string[];
  rows: QuarterlyFinancialRow[];
};

export type StockDetailsResponse = {
  symbol: string;
  name?: string | null;
  /** FMP company profile description */
  description?: string | null;
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
    ema30?: number | null;
    ema50?: number | null;
    ema100?: number | null;
    ema200?: number | null;
    rsi?: number | null;
    macd?: number | null;
    macdSignal?: number | null;
    macdHist?: number | null;
    signal?: string | null;
    volume?: number | null;
    volEma5?: number | null;
    volRatio?: number | null;
    priceUp?: boolean | null;
  }[];
  history?: { date: string; close: number; ema_10?: number; ema_20?: number }[];
  /** Last 8 reported quarters (FMP) + live last price; UI may show 4 or 8 columns */
  quarterly_financials?: QuarterlyFinancials | null;
  /** Last 3 fiscal years (FMP annual statements) + live last price */
  annual_financials?: QuarterlyFinancials | null;
};

export type PeerRow = {
  symbol: string;
  name?: string | null;
  mkt_cap?: number | null;
  signal: Signal;
  return_1d?: number | null;
  return_1w?: number | null;
  return_1m?: number | null;
  return_3m?: number | null;
  return_ytd?: number | null;
  /** Weekly score signals (~1y), oldest → newest — same convention as dashboard heatmap */
  signals_1y?: Signal[];
  signals_1y_dates?: string[];
  is_subject?: boolean;
};

export type PeersResponse = {
  subject_symbol: string;
  sector?: string | null;
  /** "fmp" = FMP stock-peers API (filtered to index); "sector" = same-sector fallback */
  peer_source?: string | null;
  peers: PeerRow[];
};

/** FMP stock news article (normalized in backend). */
export type StockNewsItem = {
  title: string;
  text?: string | null;
  url?: string | null;
  published_at?: string | null;
  site?: string | null;
};

export type StockNewsResponse = {
  symbol: string;
  items: StockNewsItem[];
};

