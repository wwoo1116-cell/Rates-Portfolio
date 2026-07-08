"""Z-score mean-reversion backtest endpoint for the Overview/RV dashboard."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, HTTPException

from ...services.spread_backtest_service import run_spread_backtest
from ..models import (
    BacktestPointOut,
    BacktestSummaryOut,
    BacktestTradeOut,
    SpreadBacktestResponse,
)

router = APIRouter(prefix="/api/spread-backtest")


@router.get("", response_model=SpreadBacktestResponse)
def spread_backtest_endpoint(
    start: date,
    end: date,
    short: str,
    long: str,
    lookback: int = 60,
    entry_z: float = 2.0,
    exit_z: float = 0.5,
    stop_z: float = 3.5,
    cost_bp: float = 0.05,
    notional: float = 1_000_000.0,
) -> SpreadBacktestResponse:
    if start > end:
        raise HTTPException(status_code=400, detail="start는 end보다 이후일 수 없습니다.")
    if entry_z <= exit_z:
        raise HTTPException(status_code=400, detail="entry_z는 exit_z보다 커야 합니다.")
    if stop_z <= entry_z:
        raise HTTPException(status_code=400, detail="stop_z는 entry_z보다 커야 합니다.")

    result = run_spread_backtest(
        start, end, short, long, lookback, entry_z, exit_z, stop_z, cost_bp, notional
    )
    return SpreadBacktestResponse(
        short=short,
        long=long,
        lookback=lookback,
        entry_z=entry_z,
        exit_z=exit_z,
        stop_z=stop_z,
        cost_bp=cost_bp,
        notional=notional,
        points=[
            BacktestPointOut(
                valuation_date=p.valuation_date,
                spread_bp=p.spread_bp,
                z_score=p.z_score,
                position=p.position,
                daily_pnl=p.daily_pnl,
                cumulative_pnl=p.cumulative_pnl,
            )
            for p in result.points
        ],
        trades=[
            BacktestTradeOut(
                entry_date=t.entry_date,
                exit_date=t.exit_date,
                direction=t.direction,
                entry_z=t.entry_z,
                exit_z=t.exit_z,
                entry_spread_bp=t.entry_spread_bp,
                exit_spread_bp=t.exit_spread_bp,
                pnl=t.pnl,
                exit_reason=t.exit_reason,
            )
            for t in result.trades
        ],
        summary=BacktestSummaryOut(
            total_pnl=result.summary.total_pnl,
            max_drawdown=result.summary.max_drawdown,
            win_rate=result.summary.win_rate,
            sharpe_ratio=result.summary.sharpe_ratio,
            num_trades=result.summary.num_trades,
        ),
    )
