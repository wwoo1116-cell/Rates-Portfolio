"""
Z-score mean-reversion backtest on a tenor-pair spread (e.g. 1Y vs 3Y swap
rates), for the Overview/RV dashboard's "Backtest" feature.

Reuses rate_history_service.get_rate_spread() for the underlying spread
series -- this module must never recompute a spread from raw tenor rates
itself, only simulate a trading strategy on top of what that function
already returns.

Convention: pnl = direction * notional * delta_spread_bp. `notional` here is
a per-bp dollar sensitivity, not a swap notional -- there's no DV01 or
day-count in this backtest, just a bet on a spread number expressed in bp.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from math import sqrt
from statistics import fmean, pstdev

from . import rate_history_service


@dataclass
class BacktestPoint:
    valuation_date: date
    spread_bp: float
    z_score: float | None
    position: int  # -1, 0, +1 -- position held DURING this day
    daily_pnl: float
    cumulative_pnl: float


@dataclass
class BacktestTrade:
    entry_date: date
    exit_date: date
    direction: int  # +1 or -1
    entry_z: float
    exit_z: float
    entry_spread_bp: float
    exit_spread_bp: float
    pnl: float
    exit_reason: str  # "exit" | "stop"


@dataclass
class BacktestSummary:
    total_pnl: float
    max_drawdown: float
    win_rate: float | None
    sharpe_ratio: float | None
    num_trades: int


@dataclass
class BacktestResult:
    points: list[BacktestPoint] = field(default_factory=list)
    trades: list[BacktestTrade] = field(default_factory=list)
    summary: BacktestSummary = field(
        default_factory=lambda: BacktestSummary(0.0, 0.0, None, None, 0)
    )


def _rolling_z_scores(spreads: list[float], lookback: int) -> list[float | None]:
    """Trailing INCLUSIVE window of `lookback` observations ending at each
    index (Bollinger-band convention: today's value is part of its own
    window). Fewer than `lookback` points of history so far -> None, which
    also naturally covers lookback > len(spreads) (every point is None, so
    the strategy never trades -- no crash, no fabricated signal)."""
    z_scores: list[float | None] = []
    for i in range(len(spreads)):
        if i < lookback - 1:
            z_scores.append(None)
            continue
        window = spreads[i - lookback + 1 : i + 1]
        mean = fmean(window)
        std = pstdev(window)
        z_scores.append(None if std == 0 else (spreads[i] - mean) / std)
    return z_scores


def run_spread_backtest(
    start_date: date,
    end_date: date,
    short: str,
    long: str,
    lookback: int,
    entry_z: float,
    exit_z: float,
    stop_z: float,
    cost_bp: float,
    notional: float,
) -> BacktestResult:
    spread_points = rate_history_service.get_rate_spread(start_date, end_date, short, long)
    if not spread_points:
        return BacktestResult()

    dates = [p.valuation_date for p in spread_points]
    spreads = [p.spread_bp for p in spread_points]
    z_scores = _rolling_z_scores(spreads, lookback)

    points: list[BacktestPoint] = []
    trades: list[BacktestTrade] = []

    position = 0  # -1, 0, +1
    entry_idx: int | None = None
    entry_z_val: float | None = None
    trade_pnl = 0.0
    cumulative = 0.0

    for i, d in enumerate(dates):
        daily_pnl = 0.0
        z = z_scores[i]

        if position != 0:
            daily_pnl += position * notional * (spreads[i] - spreads[i - 1])
            trade_pnl += daily_pnl

            if z is not None:
                should_stop = abs(z) >= stop_z
                should_exit = abs(z) <= exit_z
                if should_stop or should_exit:
                    exit_cost = notional * cost_bp
                    daily_pnl -= exit_cost
                    trade_pnl -= exit_cost
                    trades.append(
                        BacktestTrade(
                            entry_date=dates[entry_idx],
                            exit_date=d,
                            direction=position,
                            entry_z=entry_z_val,
                            exit_z=z,
                            entry_spread_bp=spreads[entry_idx],
                            exit_spread_bp=spreads[i],
                            pnl=trade_pnl,
                            exit_reason="stop" if should_stop else "exit",
                        )
                    )
                    position = 0
                    entry_idx = None
                    entry_z_val = None
                    trade_pnl = 0.0
        elif z is not None and abs(z) >= entry_z:
            # spread too high vs its rolling mean -> bet it narrows (short);
            # too low -> bet it widens (long).
            position = -1 if z > 0 else 1
            entry_idx = i
            entry_z_val = z
            entry_cost = notional * cost_bp
            daily_pnl -= entry_cost
            trade_pnl = daily_pnl

        cumulative += daily_pnl
        points.append(
            BacktestPoint(
                valuation_date=d,
                spread_bp=spreads[i],
                z_score=z,
                position=position,
                daily_pnl=daily_pnl,
                cumulative_pnl=cumulative,
            )
        )

    summary = _summarize(points, trades)
    return BacktestResult(points=points, trades=trades, summary=summary)


def _summarize(points: list[BacktestPoint], trades: list[BacktestTrade]) -> BacktestSummary:
    total_pnl = points[-1].cumulative_pnl if points else 0.0

    max_drawdown = 0.0
    running_max = float("-inf")
    for p in points:
        running_max = max(running_max, p.cumulative_pnl)
        max_drawdown = max(max_drawdown, running_max - p.cumulative_pnl)

    win_rate = (sum(1 for t in trades if t.pnl > 0) / len(trades)) if trades else None

    daily_pnls = [p.daily_pnl for p in points]
    sharpe_ratio: float | None = None
    if len(daily_pnls) >= 2:
        std = pstdev(daily_pnls)
        if std != 0:
            sharpe_ratio = fmean(daily_pnls) / std * sqrt(252)

    return BacktestSummary(
        total_pnl=total_pnl,
        max_drawdown=max_drawdown,
        win_rate=win_rate,
        sharpe_ratio=sharpe_ratio,
        num_trades=len(trades),
    )
