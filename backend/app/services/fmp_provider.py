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


def _profile_first_row(data: Any) -> dict[str, Any]:
    if isinstance(data, list) and data:
        row = data[0]
        return row if isinstance(row, dict) else {}
    if isinstance(data, dict):
        return data
    return {}


def _coerce_mkt_cap(row: dict[str, Any]) -> float | None:
    for key in ("mktCap", "marketCap", "marketcap", "market_cap", "mkt_cap"):
        raw = row.get(key)
        if raw is None:
            continue
        try:
            return float(raw)
        except (TypeError, ValueError):
            continue
    return None


def _to_fmp_symbol(symbol: str) -> str:
    """
    Convert internal ticker to the FMP format.

    - Keep exchange suffixes like `.NS`, `.T`, `.SS` intact (FMP expects the dot).
    - Convert class-share tickers like `BRK.B` -> `BRK-B`.
    """
    s = (symbol or "").strip()
    if not s:
        return s

    # Preserve exchange suffix symbols (e.g. RELIANCE.NS, 1306.T, 000001.SS).
    # Heuristic: if the last token after '.' is 2-4 chars (exchange code),
    # keep dots as-is.
    if "." in s:
        base, suffix = s.rsplit(".", 1)
        if 2 <= len(suffix) <= 4:
            return s

    # Otherwise treat '.' as a class separator (e.g. BRK.B -> BRK-B).
    return s.replace(".", "-")


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

    async def fetch_peer_metadata(
        self,
        symbols: list[str],
        timeout_seconds: float = 30.0,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Per symbol: mkt_cap, display name (company), latest stock_news published date (ISO date).
        """
        result: Dict[str, Dict[str, Any]] = {
            s: {"mkt_cap": None, "name": None, "announcement_date": None} for s in symbols
        }
        if not symbols:
            return result

        sem = asyncio.Semaphore(2)
        headers = {"User-Agent": "Mozilla/5.0"}
        timeout = httpx.Timeout(timeout_seconds)

        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:

            async def one(sym: str) -> None:
                async with sem:
                    if self.config.symbol_delay_seconds > 0:
                        await asyncio.sleep(self.config.symbol_delay_seconds)
                    fmp = _to_fmp_symbol(sym)
                    # Profile: market cap + company name (v3, then stable if gaps)
                    try:
                        purl = f"{self.config.base_url}/api/v3/profile/{fmp}"
                        pdata = await self._fetch_json(
                            client, purl, params={"apikey": self.config.api_key}, timeout_seconds=timeout_seconds
                        )
                        row = _profile_first_row(pdata)
                        mc = _coerce_mkt_cap(row)
                        if mc is not None:
                            result[sym]["mkt_cap"] = mc
                        nm = row.get("companyName") or row.get("name")
                        if nm:
                            result[sym]["name"] = str(nm)
                    except Exception as e:
                        logger.debug("profile v3 %s: %s", sym, e)

                    if result[sym]["mkt_cap"] is None or result[sym]["name"] is None:
                        try:
                            surl = f"{self.config.base_url}/stable/profile"
                            sdata = await self._fetch_json(
                                client,
                                surl,
                                params={"symbol": fmp, "apikey": self.config.api_key},
                                timeout_seconds=timeout_seconds,
                            )
                            srow = _profile_first_row(sdata)
                            if result[sym]["mkt_cap"] is None:
                                mc2 = _coerce_mkt_cap(srow)
                                if mc2 is not None:
                                    result[sym]["mkt_cap"] = mc2
                            if result[sym]["name"] is None:
                                nm2 = srow.get("companyName") or srow.get("name")
                                if nm2:
                                    result[sym]["name"] = str(nm2)
                        except Exception as e:
                            logger.debug("profile stable %s: %s", sym, e)

                    try:
                        nurl = f"{self.config.base_url}/api/v3/stock_news"
                        ndata = await self._fetch_json(
                            client,
                            nurl,
                            params={
                                "tickers": sym,
                                "limit": 5,
                                "apikey": self.config.api_key,
                            },
                            timeout_seconds=timeout_seconds,
                        )
                        if isinstance(ndata, list) and ndata:
                            first = ndata[0]
                            if isinstance(first, dict):
                                pd = (
                                    first.get("publishedDate")
                                    or first.get("date")
                                    or first.get("published_date")
                                    or first.get("publishedAt")
                                )
                                if pd:
                                    sdt = str(pd).strip()
                                    if " " in sdt:
                                        sdt = sdt.split(" ")[0]
                                    result[sym]["announcement_date"] = sdt
                    except Exception as e:
                        logger.debug("stock_news %s: %s", sym, e)

            await asyncio.gather(*(one(s) for s in symbols))

        return result

    async def fetch_stock_profile_summary(
        self, symbol: str, timeout_seconds: float = 15.0
    ) -> dict[str, str | None]:
        """
        Company display name + description from FMP profile.
        Tries stable/profile first (documented), then v3/profile.
        """
        fmp = _to_fmp_symbol(symbol)
        out: dict[str, str | None] = {"name": None, "description": None}
        headers = {"User-Agent": "Mozilla/5.0"}
        timeout = httpx.Timeout(timeout_seconds)

        def _pick_desc(row: dict[str, Any]) -> str | None:
            for key in (
                "description",
                "longBusinessSummary",
                "longDescription",
                "companyDescription",
                "shortBusinessSummary",
                "businessSummary",
                "desc",
                "about",
            ):
                raw = row.get(key)
                if raw is None:
                    continue
                s = str(raw).strip()
                if s and s.lower() not in ("none", "n/a"):
                    return s
            return None

        def _pick_name(row: dict[str, Any]) -> str | None:
            for key in ("companyName", "company_name", "name", "shortName"):
                raw = row.get(key)
                if raw is None:
                    continue
                s = str(raw).strip()
                if s:
                    return s
            return None

        def _sector_industry_blurb(row: dict[str, Any]) -> str | None:
            """When FMP omits prose, still show something useful in the drawer."""
            parts: list[str] = []
            for key in ("sector", "industry"):
                raw = row.get(key)
                if raw is None:
                    continue
                s = str(raw).strip()
                if s and s not in parts:
                    parts.append(s)
            exc = row.get("exchangeShortName") or row.get("exchange")
            if exc:
                e = str(exc).strip()
                if e and e not in parts:
                    parts.append(e)
            if not parts:
                return None
            return " · ".join(parts)

        def _merge_row(row: dict[str, Any]) -> None:
            if not row:
                return
            nm = _pick_name(row)
            if nm and out["name"] is None:
                out["name"] = nm
            desc = _pick_desc(row)
            if desc and out["description"] is None:
                out["description"] = desc

        def _profile_rows(data: Any) -> list[dict[str, Any]]:
            if isinstance(data, list):
                return [r for r in data if isinstance(r, dict)]
            if isinstance(data, dict) and data:
                # Error payloads are dicts without profile keys; still merge if any useful key exists.
                return [data]
            return []

        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            endpoints: tuple[tuple[str, dict[str, str]], ...] = (
                (
                    f"{self.config.base_url}/stable/profile",
                    {"symbol": fmp, "apikey": self.config.api_key},
                ),
                (
                    f"{self.config.base_url}/api/v3/profile/{fmp}",
                    {"apikey": self.config.api_key},
                ),
            )
            last_nonempty: dict[str, Any] = {}
            for purl, params in endpoints:
                try:
                    pdata = await self._fetch_json(
                        client, purl, params=params, timeout_seconds=timeout_seconds
                    )
                    rows = _profile_rows(pdata)
                    for row in rows:
                        if row:
                            last_nonempty = row
                        _merge_row(row)
                    if out["name"] and out["description"]:
                        break
                except Exception as e:
                    logger.debug("profile summary %s %s: %s", purl, symbol, e)

            if out["description"] is None and last_nonempty:
                blurb = _sector_industry_blurb(last_nonempty)
                if blurb:
                    out["description"] = blurb

        return out

    def _normalize_stock_news_rows(self, raw: Any, cap: int) -> list[dict[str, Any]]:
        if not isinstance(raw, list):
            return []
        out: list[dict[str, Any]] = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            title = row.get("title") or row.get("headline")
            if not title:
                continue
            t = str(title).strip()
            if not t:
                continue
            pub = (
                row.get("publishedDate")
                or row.get("date")
                or row.get("published_date")
                or row.get("publishedAt")
            )
            pub_s: str | None = None
            if pub is not None:
                pub_s = str(pub).strip()
                if " " in pub_s:
                    pub_s = pub_s.split(" ")[0]
                if not pub_s:
                    pub_s = None
            text_raw = row.get("text") or row.get("content") or row.get("description")
            text_s: str | None = None
            if text_raw is not None:
                text_s = str(text_raw).strip()
                if len(text_s) > 2500:
                    text_s = text_s[:2500] + "…"
                if not text_s:
                    text_s = None
            url_raw = row.get("url") or row.get("link")
            url_s = str(url_raw).strip() if url_raw else None
            if url_s == "":
                url_s = None
            site_raw = row.get("site") or row.get("publisher") or row.get("source")
            site_s = str(site_raw).strip() if site_raw else None
            if site_s == "":
                site_s = None
            out.append(
                {
                    "title": t,
                    "text": text_s,
                    "url": url_s,
                    "published_at": pub_s,
                    "site": site_s,
                }
            )
            if len(out) >= cap:
                break
        return out

    async def fetch_stock_news(
        self,
        symbol: str,
        *,
        limit: int = 20,
        timeout_seconds: float = 20.0,
    ) -> list[dict[str, Any]]:
        """
        FMP stock news: v3 stock_news, then stable/news/stock if needed.
        """
        fmp = _to_fmp_symbol(symbol)
        cap = max(1, min(50, limit))
        headers = {"User-Agent": "Mozilla/5.0"}
        timeout = httpx.Timeout(timeout_seconds)

        async with httpx.AsyncClient(timeout=timeout, headers=headers) as client:
            try:
                url = f"{self.config.base_url}/api/v3/stock_news"
                params = {
                    "tickers": fmp,
                    "limit": cap,
                    "apikey": self.config.api_key,
                }
                data = await self._fetch_json(
                    client, url, params=params, timeout_seconds=timeout_seconds
                )
                norm = self._normalize_stock_news_rows(data, cap)
                if norm:
                    return norm
            except Exception as e:
                logger.debug("stock_news v3 %s: %s", symbol, e)

            try:
                url = f"{self.config.base_url}/stable/news/stock"
                params = {
                    "symbols": fmp,
                    "limit": cap,
                    "apikey": self.config.api_key,
                }
                data = await self._fetch_json(
                    client, url, params=params, timeout_seconds=timeout_seconds
                )
                return self._normalize_stock_news_rows(data, cap)
            except Exception as e:
                logger.debug("stock_news stable %s: %s", symbol, e)

        return []

    async def fetch_stock_peers_symbols(self, symbol: str, timeout_seconds: float = 20.0) -> list[str]:
        """
        FMP curated peers: /stable/stock-peers?symbol=...
        Returns ticker strings in API order (may use '-' e.g. BRK-B).
        """
        fmp = _to_fmp_symbol(symbol)
        headers = {"User-Agent": "Mozilla/5.0"}
        url = f"{self.config.base_url}/stable/stock-peers"
        params = {"symbol": fmp, "apikey": self.config.api_key}
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(timeout_seconds), headers=headers
            ) as client:
                data = await self._fetch_json(client, url, params=params, timeout_seconds=timeout_seconds)
        except Exception as e:
            logger.warning("stock-peers %s: %s", symbol, e)
            return []

        out: list[str] = []

        def _push(s: Any) -> None:
            if s is None:
                return
            t = str(s).strip()
            if t and t not in out:
                out.append(t)

        if isinstance(data, list):
            for row in data:
                if isinstance(row, dict):
                    _push(row.get("symbol") or row.get("ticker") or row.get("stockSymbol"))
                elif isinstance(row, str):
                    _push(row)
        elif isinstance(data, dict):
            for key in ("symbolPeerList", "peers", "peerList", "data", "symbols"):
                chunk = data.get(key)
                if isinstance(chunk, list):
                    for row in chunk:
                        if isinstance(row, dict):
                            _push(row.get("symbol") or row.get("ticker"))
                        elif isinstance(row, str):
                            _push(row)
                    break

        return out

    async def fetch_fmp_quarterly_series(
        self,
        symbol: str,
        resource: str,
        limit: int = 20,
        timeout_seconds: float = 22.0,
        require_quarter_period: bool = True,
    ) -> list[dict[str, Any]]:
        """
        Generic quarterly series: resource is v3 path segment, e.g.
        income-statement, balance-sheet-statement, cash-flow-statement, ratios, key-metrics.
        """
        fmp = _to_fmp_symbol(symbol)
        headers = {"User-Agent": "Mozilla/5.0"}
        stable_resource = resource
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), headers=headers
        ) as client:
            for url, params in (
                (
                    f"{self.config.base_url}/api/v3/{resource}/{fmp}",
                    {"period": "quarter", "limit": limit, "apikey": self.config.api_key},
                ),
                (
                    f"{self.config.base_url}/stable/{stable_resource}",
                    {
                        "symbol": fmp,
                        "period": "quarter",
                        "limit": limit,
                        "apikey": self.config.api_key,
                    },
                ),
            ):
                try:
                    data = await self._fetch_json(
                        client, url, params=params, timeout_seconds=timeout_seconds
                    )
                    if isinstance(data, list) and data:
                        rows = [r for r in data if isinstance(r, dict)]
                        if not require_quarter_period:
                            return rows
                        q_only = [
                            r
                            for r in rows
                            if str(r.get("period", "")).strip().upper().startswith("Q")
                        ]
                        return q_only if q_only else rows
                except Exception as e:
                    logger.debug("fmp quarterly %s %s %s: %s", resource, symbol, url, e)
                    continue
        return []

    async def fetch_fmp_annual_series(
        self,
        symbol: str,
        resource: str,
        limit: int = 6,
        timeout_seconds: float = 22.0,
    ) -> list[dict[str, Any]]:
        """Fiscal-year statements (same resources as quarterly, period=annual)."""
        fmp = _to_fmp_symbol(symbol)
        headers = {"User-Agent": "Mozilla/5.0"}
        stable_resource = resource
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds), headers=headers
        ) as client:
            for url, params in (
                (
                    f"{self.config.base_url}/api/v3/{resource}/{fmp}",
                    {"period": "annual", "limit": limit, "apikey": self.config.api_key},
                ),
                (
                    f"{self.config.base_url}/stable/{stable_resource}",
                    {
                        "symbol": fmp,
                        "period": "annual",
                        "limit": limit,
                        "apikey": self.config.api_key,
                    },
                ),
            ):
                try:
                    data = await self._fetch_json(
                        client, url, params=params, timeout_seconds=timeout_seconds
                    )
                    if isinstance(data, list) and data:
                        return [r for r in data if isinstance(r, dict)]
                except Exception as e:
                    logger.debug("fmp annual %s %s %s: %s", resource, symbol, url, e)
                    continue
        return []

    async def fetch_income_statement_quarterly(
        self,
        symbol: str,
        limit: int = 12,
        timeout_seconds: float = 25.0,
    ) -> list[dict[str, Any]]:
        """Quarterly income-statement lines."""
        return await self.fetch_fmp_quarterly_series(
            symbol, "income-statement", limit, timeout_seconds, True
        )

