from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List

from app.schemas.common import Constituent, IndexInfo


@dataclass(frozen=True)
class Universe:
    name: str
    label: str
    constituents: List[Constituent]


class UniverseService:
    def __init__(self, universe_dir: Path) -> None:
        self.universe_dir = universe_dir

    def list_indices(self) -> List[IndexInfo]:
        return [
            IndexInfo(name="sp500", label="S&P 500"),
            IndexInfo(name="nifty50", label="NIFTY 50"),
            IndexInfo(name="niftynext50", label="NIFTY NEXT 50"),
            IndexInfo(name="nasdaq100", label="NASDAQ 100"),
            IndexInfo(name="dow30", label="DOW 30"),
            IndexInfo(name="custom", label="Custom Watchlist (Coming Soon)"),
        ]

    def get_universe(self, index_name: str) -> Universe:
        indices = {i.name: i.label for i in self.list_indices()}
        if index_name not in indices:
            raise ValueError(f"Unknown index_name: {index_name}")

        if index_name == "custom":
            return Universe(name="custom", label=indices[index_name], constituents=[])

        p = self.universe_dir / f"{index_name}.json"
        if not p.exists():
            raise ValueError(f"Universe file missing: {p}")

        data = json.loads(p.read_text(encoding="utf-8"))
        items = []
        for it in data.get("constituents", []):
            if isinstance(it, str):
                items.append(Constituent(symbol=it, name=None))
            else:
                items.append(Constituent(
                    symbol=it["symbol"],
                    name=it.get("name"),
                    sector=it.get("sector"),
                    sub_sector=it.get("sub_sector"),
                ))
        return Universe(name=index_name, label=indices[index_name], constituents=items)
