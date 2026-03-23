from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import random
from typing import Any, Dict, Iterable, Optional

import httpx
import pandas as pd

from app.services.data_provider import DataProvider, DownloadResult
from app.utils.errors import ProviderRateLimitError

logger = logging.getLogger(__name__)


def _to_fmp_symbol(symbol: str) -> str:
    # FMP uses '-' for tickers like BRK.B -> BRK-B
    return symbol.replace(".", "-")


def _parse_period_to_range(period: str) -> tuple[str, str]:
    """
    period examples (from current settings):
    - "2y" => last 2 years
    - "1y" => last 1 year
    - "5d" => last 5 days
    """
    p = (period or "").strip().lower()
    now = datetime.now(timezone.utc).date()

    if not p:
        # Fallback: 2 years
        from_dt = now - timedelta(days=365 * 2)
        return from_dt.isoformat(), now.isoformat()

    unit = p[-1]
    qty_raw = p[:-1]
    try:
        qty = int(qty_raw)
    except ValueError:
        # Fallback: 2 years
        from_dt = now - timedelta(days=365 * 2)
        return from_dt.isoformat(), now.isoformat()

    if unit == "y":
        from_dt = now - timedelta(days=365 * qty)
    elif unit == "m":
        from_dt = now - timedelta(days=30 * qty)
    elif unit == "d":
        from_dt = now - timedelta(days=qty)
    else:
        from_dt = now - timedelta(days=365 * 2)

    return from_dt.isoformat(), now.isoformat()


def _normalize_prices_from_fmp(historical: list[dict], symbol: str) -> pd.DataFrame:
    if not historical:
        return pd.DataFrame()

    # FMP returns values as numbers/strings; keep robust conversion.
    df = pd.DataFrame(historical)
    if "date" not in df.columns:
        return pd.DataFrame()

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date"])
    df = df.set_index("date").sort_index()

    # FMP field names (common):
    # open, high, low, close, volume, adjClose
    col_map = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
        "adjClose": "Adj Close",
        "adj_close": "Adj Close",  # just in case
        "adjustedClose": "Adj Close",  # used by some FMP endpoints
    }
    df = df.rename(columns=col_map)

    # Ensure expected columns exist
    for c in ["Open", "High", "Low", "Close", "Adj Close", "Volume"]:
        if c not in df.columns:
            df[c] = pd.NA

    # If adj close isn't provided by endpoint, use close.
    if df["Adj Close"].isna().all() and "Close" in df.columns:
        df["Adj Close"] = df["Close"]

    # Keep exactly the columns we expect
    df = df[["Open", "High", "Low", "Close", "Adj Close", "Volume"]]

    # Drop rows with no close
    df = df.dropna(subset=["Close"], how="all")
    return df


@dataclass(frozen=True)
class FmpConfig:
    api_key: str
    base_url: str = "https://financialmodelingprep.com"
    # Keep this low to avoid starter-plan rate limits.
    max_concurrency: int = 1
    # Retry policy for HTTP 429 responses
    max_retries_on_429: int = 5
    retry_base_delay_seconds: float = 1.0
    # Gentle pacing between symbols (mimics your working script).
    symbol_delay_seconds: float = 0.15


class FMPProvider(DataProvider):
    def __init__(self, api_key: Optional[str] = None) -> None:
        # Prefer explicit arg, fallback to env var.
        key = (api_key or "").strip() or (  # noqa: E501
            __import__("os").environ.get("FMP_API_KEY", "").strip()
        )
        if not key:
            raise ValueError("Missing FMP_API_KEY. Set it in your environment (or .env).")
        self.config = FmpConfig(api_key=key)

    async def _fetch_json(
        self,
        client: httpx.AsyncClient,
        url: str,
        params: dict,
        timeout_seconds: float,
    ) -> Any:
        for attempt in range(1, self.config.max_retries_on_429 + 1):
            resp = await client.get(url, params=params, timeout=timeout_seconds)
            if resp.status_code in (401, 403):
                raise PermissionError(f"FMP auth failed: {resp.status_code}")

            if resp.status_code == 429:
                # Backoff and retry; only raise after max attempts.
                if attempt >= self.config.max_retries_on_429:
                    raise ProviderRateLimitError("FMP rate-limited (429).")
                delay = (self.config.retry_base_delay_seconds * (2 ** (attempt - 1))) + random.random()
                await asyncio.sleep(delay)
                continue

            resp.raise_for_status()
            return resp.json()

        # Should be unreachable, but keeps type checkers happy.
        raise ProviderRateLimitError("FMP rate-limited (429).")

    async def _download_symbol_history(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        symbol: str,
        from_date: str,
        to_date: str,
        timeout_seconds: float,
    ) -> pd.DataFrame:
        async with sem:
            if self.config.symbol_delay_seconds > 0:
                # With max_concurrency=1 this effectively paces sequential requests.
                await asyncio.sleep(self.config.symbol_delay_seconds)
            # Match the endpoint style from your working script.
            # GET /stable/historical-price-eod/full?symbol=...&from=...&to=...
            fmp_symbol = _to_fmp_symbol(symbol)
            url = f"{self.config.base_url}/stable/historical-price-eod/full"
            params = {
                "symbol": fmp_symbol,
                "from": from_date,
                "to": to_date,
                "apikey": self.config.api_key,
            }

            data = await self._fetch_json(
                client, url, params=params, timeout_seconds=timeout_seconds
            )

            historical: list[dict] = []
            if isinstance(data, list):
                historical = data
            elif isinstance(data, dict):
                maybe = data.get("historical")
                if isinstance(maybe, list):
                    historical = maybe
                else:
                    historical = [data] if data else []

            return _normalize_prices_from_fmp(historical, symbol)

    async def _fetch_symbol_name(
        self,
        client: httpx.AsyncClient,
        sem: asyncio.Semaphore,
        symbol: str,
        timeout_seconds: float,
    ) -> Optional[str]:
        async with sem:
            fmp_symbol = _to_fmp_symbol(symbol)
            url = f"{self.config.base_url}/profile/{fmp_symbol}"
            params = {"apikey": self.config.api_key}
            try:
                data = await self._fetch_json(client, url, params=params, timeout_seconds=timeout_seconds)
            except ProviderRateLimitError:
                raise
            except Exception:
                return None

            # FMP returns either dict or list depending on endpoint; handle both.
            if isinstance(data, list):
                data = data[0] if data else {}
            if not isinstance(data, dict):
                return None
            return data.get("companyName") or data.get("name")

    async def download_daily_history(
        self,
        symbols: Iterable[str],
        period: str,
        interval: str,
        timeout_seconds: float,
    ) -> DownloadResult:
        sym_list = [s for s in symbols if s]
        if not sym_list:
            return DownloadResult(prices_by_symbol={}, names_by_symbol={})

        from_date, to_date = _parse_period_to_range(period)
        logger.info("Downloading FMP history for %d symbols (%s..%s)", len(sym_list), from_date, to_date)

        sem = asyncio.Semaphore(self.config.max_concurrency)
        timeout = httpx.Timeout(timeout_seconds)
        # Some providers apply different heuristics based on headers.
        headers = {"User-Agent": "Mozilla/5.0"}
        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            try:
                # Prices first (primary signal).
                tasks = [
                    self._download_symbol_history(client, sem, s, from_date, to_date, timeout_seconds)
                    for s in sym_list
                ]
                dfs = await asyncio.gather(*tasks)
            except ProviderRateLimitError as e:
                raise e
            except Exception as e:
                logger.warning("FMP download failed: %s", e)
                dfs = [pd.DataFrame() for _ in sym_list]

            prices_by_symbol: Dict[str, pd.DataFrame] = {}
            for s, df in zip(sym_list, dfs):
                prices_by_symbol[s] = df

            # Names: starter plan is typically rate-limited; pricing data is the critical path.
            names_by_symbol: Dict[str, Optional[str]] = {s: None for s in sym_list}

        return DownloadResult(prices_by_symbol=prices_by_symbol, names_by_symbol=names_by_symbol)

    # ── Sector / sub-sector data ──

    _INDEX_ENDPOINT_MAP = {
        "sp500": "sp500_constituent",
        "nasdaq100": "nasdaq_constituent",
        "dow30": "dowjones_constituent",
    }

    async def fetch_sector_map(
        self, index_name: str, timeout_seconds: float = 15.0
    ) -> Dict[str, Dict[str, str | None]]:
        """
        Returns {symbol: {"sector": ..., "sub_sector": ...}} for known indices.
        Falls back to empty dict for unsupported indices.
        """
        endpoint = self._INDEX_ENDPOINT_MAP.get(index_name)
        if not endpoint:
            return {}

        url = f"{self.config.base_url}/api/v3/{endpoint}"
        params = {"apikey": self.config.api_key}
        headers = {"User-Agent": "Mozilla/5.0"}
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout_seconds), headers=headers
            ) as client:
                data = await self._fetch_json(client, url, params, timeout_seconds)
            if not isinstance(data, list):
                return {}
            result: Dict[str, Dict[str, str | None]] = {}
            for item in data:
                sym = (item.get("symbol") or "").strip()
                if not sym:
                    continue
                result[sym] = {
                    "sector": item.get("sector") or None,
                    "sub_sector": item.get("subSector") or item.get("industry") or None,
                }
            return result
        except Exception as e:
            logger.warning("Failed fetching sector data for %s: %s", index_name, e)
            return {}

