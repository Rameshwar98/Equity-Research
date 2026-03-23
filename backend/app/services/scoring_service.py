from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import pandas as pd

from app.utils.types import ScoreKey


@dataclass(frozen=True)
class Scores:
    score_1: pd.Series
    score_2: pd.Series
    score_3: pd.Series

    def get(self, key: ScoreKey) -> pd.Series:
        if key == "score_1":
            return self.score_1
        if key == "score_2":
            return self.score_2
        return self.score_3


class ScoringService:
    def compute_scores(
        self,
        close: pd.Series,
        avg_last5: pd.Series,
        prev_close: pd.Series,
        avg_all_emas: pd.Series,
    ) -> Scores:
        score_1 = close / avg_last5
        score_2 = close / prev_close
        score_3 = close / avg_all_emas
        return Scores(score_1=score_1, score_2=score_2, score_3=score_3)

    def latest_scores(self, scores: Scores) -> Dict[str, float | None]:
        def _last(s: pd.Series) -> float | None:
            if s is None or s.empty:
                return None
            v = s.iloc[-1]
            return None if pd.isna(v) else float(v)

        return {
            "score_1": _last(scores.score_1),
            "score_2": _last(scores.score_2),
            "score_3": _last(scores.score_3),
        }

