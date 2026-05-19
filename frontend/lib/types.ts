export type Signal = "BUY" | "HOLD" | "SELL" | "N/A";
export type ScoreKey = "score_1" | "score_2" | "score_3";

export type IndexInfo = { name: string; label: string };
export type Constituent = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  sub_sector?: string | null;
};

export type AnalysisRow = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  sub_sector?: string | null;
  /** 0-based order in the selected universe list (stable layout helper). */
  universe_rank?: number | null;
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
  /** ~52 weekly closes aligned to signals_1y_dates (oldest → newest) */
  trend_1y_closes?: (number | null)[];
  trend_1y_dates?: string[];
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
  /** Which score formula the timeline + signals use (matches query param). */
  selected_score?: ScoreKey;
  /** Per-session values for `selected_score`, same order as `date_labels` (most-recent first). */
  score_timeline?: (number | null)[];
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
  /** Latest value of the selected score (score_1|score_2|score_3) for this peer. */
  score?: number | null;
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

export type StrategyType = "MomentumIQ";
export type RebalanceMode = "manual" | "auto" | "both";

export type PortfolioParams = {
  universe: string;
  universe_size_cap?: number | null;
  momentum_screen_size: number;
  final_portfolio_size: number;
  ma_exit_override: boolean;
  rebalance_mode: RebalanceMode;
  benchmark?: string | null;
};

export type Portfolio = {
  id: string;
  name: string;
  strategy: StrategyType;
  params: PortfolioParams;
  chart_prefs: Record<string, boolean>;
  /** True when seeded via dev "Generate Test History" — not real performance data */
  is_test_mode?: boolean;
  created_at: string;
  updated_at: string;
};

export type PortfolioListItem = {
  id: string;
  name: string;
  strategy: StrategyType;
  universe: string;
  momentum_screen_size: number;
  final_portfolio_size: number;
  is_test_mode?: boolean;
  last_run_at?: string | null;
  holdings_count: number;
  created_at: string;
  updated_at: string;
};

/** Response from POST /api/test/seed-portfolio/:id (UI test mode seed) */
export type GenerateTestHistoryResponse = {
  ok: boolean;
  portfolio_id: string;
  snapshots_created: number;
  inception_date: string | null;
  daily_series_points: number;
};

export type MomentumScoreBand = "BUY" | "HOLD" | "WATCH" | "EXIT";
export type MomentumActionType = "HOLD" | "HOLD_WITH_WATCH" | "EXIT" | "BUY";
export type MomentumExitReason =
  | "score_breach"
  | "ma_breach"
  | "score_and_ma_breach"
  | "dropped_out_of_top100";

export type MomentumComputedRow = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  last_price: number;
  price_date: string;
  return_1y: number;
  annualized_sd: number;
  mkt_cap?: number | null;
  high_52w?: number | null;
  low_52w?: number | null;
  return_1w?: number | null;
  return_1m?: number | null;
  return_3m?: number | null;
  return_ytd?: number | null;
  signals_1y?: Signal[];
  signals_1y_dates?: string[];
  /** Screener score_3: close / avg(all EMAs). */
  score_3?: number | null;
  return_rank: number;
  sd_rank: number;
  combined_score: number;
  combined_rank: number;
  price_vs_50ma: "above" | "below";
  ma50: number;
  ma_override_active: boolean;
  band: MomentumScoreBand;
  action: MomentumActionType;
  exit_reason?: MomentumExitReason | null;
  target_weight: number;
  months_held: number;
  rank_change_vs_last_month?: number | null;
};

export type MomentumSnapshot = {
  snapshot_id: string;
  portfolio_id: string;
  created_at: string;
  holdings: MomentumComputedRow[];
  top100_ranks: Record<string, number>;
  incoming: MomentumComputedRow[];
  outgoing: MomentumComputedRow[];
  hold: MomentumComputedRow[];
  watch: MomentumComputedRow[];
  degree_of_improvement_watchlist: {
    symbol: string;
    name?: string | null;
    sector?: string | null;
    rank_delta: number;
    previous_rank: number;
    current_rank: number;
    combined_score: number;
  }[];
  skipped_symbols: string[];
  top100_rows: MomentumComputedRow[];
  on_deck?: MomentumComputedRow[];
};

export type MomentumPreview = {
  run_id: string;
  portfolio_id: string;
  created_at: string;
  current_holdings: MomentumComputedRow[];
  incoming: MomentumComputedRow[];
  outgoing: MomentumComputedRow[];
  hold: MomentumComputedRow[];
  watch: MomentumComputedRow[];
  degree_of_improvement_watchlist: {
    symbol: string;
    name?: string | null;
    sector?: string | null;
    rank_delta: number;
    previous_rank: number;
    current_rank: number;
    combined_score: number;
  }[];
  skipped_symbols: string[];
};

export type HoldingsView = {
  portfolio_id: string;
  last_snapshot?: MomentumSnapshot | null;
  previous_snapshot?: MomentumSnapshot | null;
  incoming: MomentumComputedRow[];
  outgoing: MomentumComputedRow[];
  degree_of_improvement_watchlist: {
    symbol: string;
    rank_delta: number;
    previous_rank: number;
    current_rank: number;
  }[];
};

export type AnalyticsKpis = {
  sharpe?: number | null;
  sortino?: number | null;
  sharpe_rf_assumption: string;
  sortino_rf_assumption: string;
  quality_score?: number | null; // 0..1
  avg_1y_return?: number | null;
  avg_annualized_sd?: number | null;
  spread_1m?: number | null;
  spread_3m?: number | null;
  spread_ytd?: number | null;
  spread_1y?: number | null;
};

export type AnalyticsSeriesPoint = {
  date: string;
  portfolio: number | null;
  benchmark: number | null;
};

export type AnalyticsSectorOverTimePoint = {
  date: string;
  sectors: Record<string, number>;
};

export type AnalyticsRankMovementItem = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  delta: number;
  prev_rank: number;
  cur_rank: number;
};

export type AnalyticsConcentrationCard = {
  herfindahl?: number | null;
  max_sector_weight?: number | null;
  distinct_sectors: number;
};

export type PortfolioAnalyticsResponse = {
  portfolio_id: string;
  benchmark_symbol: string;
  inception_date?: string | null;
  snapshots: number;
  kpis: AnalyticsKpis;
  charts: {
    cumulative: AnalyticsSeriesPoint[];
    drawdown: AnalyticsSeriesPoint[];
    rolling_sharpe: AnalyticsSeriesPoint[];
    scatter_holdings: MomentumComputedRow[];
    scatter_top100: MomentumComputedRow[];
    on_deck?: MomentumComputedRow[];
    scatter_median_return_1y?: number | null;
    scatter_median_sd?: number | null;
    sector_over_time: AnalyticsSectorOverTimePoint[];
    contributors_detractors: {
      contributors: MomentumComputedRow[];
      detractors: MomentumComputedRow[];
    };
    rank_movement: {
      improved: AnalyticsRankMovementItem[];
      deteriorated: AnalyticsRankMovementItem[];
    };
    concentration: AnalyticsConcentrationCard;
  };
  chart_prefs: Record<string, boolean>;
};

export type PortfolioHistoryResponse = {
  portfolio_id: string;
  snapshots: {
    snapshot_id: string;
    created_at: string;
    effective_date: string;
    holdings_count: number;
  }[];
  movements: {
    snapshot_id: string;
    effective_date: string;
    entries: number;
    exits: number;
    turnover_pct: number;
  }[];
  events: {
    effective_date: string;
    created_at: string;
    type: "entry" | "exit";
    symbol: string;
    name?: string | null;
    sector?: string | null;
    rank?: number | null;
  }[];
  charts: {
    turnover: { effective_date: string; turnover_pct: number }[];
    duration_histogram: { label: string; count: number }[];
    heatmap_columns: { key: string; label: string }[];
    rank_heatmap: {
      symbol: string;
      name?: string | null;
      sector?: string | null;
      ranks_by_snapshot: Record<string, number | null>;
    }[];
    most_stable_holdings: {
      symbol: string;
      name?: string | null;
      sector?: string | null;
      total_snapshots_held: number;
      longest_streak: number;
    }[];
  };
  holdings_by_snapshot: Record<string, MomentumComputedRow[]>;
};

export type PortfolioScheduleResponse = {
  portfolio_id: string;
  rebalance_mode: "manual" | "auto" | "both";
  market: "US" | "IN";
  next_auto_rebalance: string;
  enabled: boolean;
};

export type PortfolioDailySeriesPoint = {
  date: string;
  portfolio_value: number;
  benchmark_value: number;
};

export type HoldingsPnlRow = {
  symbol: string;
  name?: string | null;
  sector?: string | null;
  entry_price: number;
  entry_date: string;
  current_price?: number | null;
  pnl_pct?: number | null;
  pnl_abs?: number | null;
  days_held: number;
};

export type PortfolioPriceHistoryResponse = {
  daily_series: PortfolioDailySeriesPoint[];
  holdings_pnl: HoldingsPnlRow[];
  summary: {
    total_return_pct?: number | null;
    benchmark_return_pct?: number | null;
    alpha?: number | null;
    best_performer?: string | null;
    worst_performer?: string | null;
    inception_date?: string | null;
    days_tracked: number;
  };
  rebalance_dates: string[];
};

