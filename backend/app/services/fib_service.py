from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FibResult:
    high_52week: float | None
    low_52week: float | None
    px_last: float | None
    fib_61_8: float | None
    fib_50: float | None
    fib_38_2: float | None
    fib_23_6: float | None


class FibService:
    def compute(
        self,
        high_52week: float | None,
        low_52week: float | None,
        px_last: float | None,
    ) -> FibResult:
        if high_52week is None or low_52week is None:
            return FibResult(
                high_52week=high_52week,
                low_52week=low_52week,
                px_last=px_last,
                fib_61_8=None,
                fib_50=None,
                fib_38_2=None,
                fib_23_6=None,
            )
        r = high_52week - low_52week
        # exact structure requested: (high - low) * ratio + low
        fib_61_8 = (high_52week - low_52week) * 0.618 + low_52week
        fib_50 = (high_52week - low_52week) * 0.50 + low_52week
        fib_38_2 = (high_52week - low_52week) * 0.382 + low_52week
        fib_23_6 = (high_52week - low_52week) * 0.236 + low_52week
        _ = r
        return FibResult(
            high_52week=high_52week,
            low_52week=low_52week,
            px_last=px_last,
            fib_61_8=fib_61_8,
            fib_50=fib_50,
            fib_38_2=fib_38_2,
            fib_23_6=fib_23_6,
        )

