from datetime import date

import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.services import market_data_service, rate_history_service, spread_backtest_service

# 19 consecutive business days (skips the two intervening weekends); actual
# calendar validity doesn't matter since list_available_dates/load_snapshot
# are monkeypatched below -- only the backtest's own signal/position logic
# is under test, not real market data.
_WINDOW_DATES = [
    date(2024, 1, 2), date(2024, 1, 3), date(2024, 1, 4), date(2024, 1, 5),
    date(2024, 1, 8), date(2024, 1, 9), date(2024, 1, 10), date(2024, 1, 11),
    date(2024, 1, 12), date(2024, 1, 15), date(2024, 1, 16), date(2024, 1, 17),
    date(2024, 1, 18), date(2024, 1, 19), date(2024, 1, 22), date(2024, 1, 23),
    date(2024, 1, 24), date(2024, 1, 25), date(2024, 1, 26),
]

# 1Y flat at 2.80%; 3Y walks so the (3Y-1Y) spread in bp is: 10 flat days at
# 20bp (settles every rolling window used below), a sharp 4-day widen to
# 45bp, a decay back down, and a final [19.9, 20.1, 20.0] wobble -- chosen
# (and verified by directly running run_spread_backtest against it) so a
# lookback=3 z-score enters on the widen, stays open through the decay, and
# exits with z_score == 0.0 exactly on the last day, giving one clean,
# fully-closed, winning trade to assert against.
_ONE_Y = 0.0280
_SPREAD_BP_SEQUENCE = [20.0] * 10 + [45.0] * 4 + [30.0, 25.0, 19.9, 20.1, 20.0]
assert len(_SPREAD_BP_SEQUENCE) == len(_WINDOW_DATES)


def _snapshot_for(spread_bp_by_date: dict[date, float]):
    def _fake_snapshot(valuation_date: date) -> MarketSnapshot:
        three_y = _ONE_Y + spread_bp_by_date[valuation_date] / 10000.0
        return MarketSnapshot(
            valuation_date=valuation_date,
            cd_rate=0.0292,
            swap_quotes=[RateQuote(1, _ONE_Y), RateQuote(3, three_y)],
        )

    return _fake_snapshot


@pytest.fixture
def patch_market_data(monkeypatch):
    by_date = dict(zip(_WINDOW_DATES, _SPREAD_BP_SEQUENCE))
    monkeypatch.setattr(market_data_service, "list_available_dates", lambda: list(_WINDOW_DATES))
    monkeypatch.setattr(market_data_service, "load_snapshot", _snapshot_for(by_date))
    monkeypatch.setattr("irs_pricer.services.rate_history_service.load_base_rate", lambda *a, **k: None)


def _run(**overrides):
    params = dict(
        start_date=_WINDOW_DATES[0],
        end_date=_WINDOW_DATES[-1],
        short="1Y",
        long="3Y",
        lookback=3,
        entry_z=1.4,
        exit_z=0.3,
        stop_z=3.5,
        cost_bp=0.05,
        notional=1_000_000.0,
    )
    params.update(overrides)
    return spread_backtest_service.run_spread_backtest(**params)


def test_spread_series_matches_get_rate_spread_exactly(patch_market_data):
    reference = rate_history_service.get_rate_spread(_WINDOW_DATES[0], _WINDOW_DATES[-1], "1Y", "3Y")
    result = _run()
    assert [p.spread_bp for p in result.points] == [r.spread_bp for r in reference]
    assert [p.valuation_date for p in result.points] == [r.valuation_date for r in reference]


def test_widen_then_revert_produces_one_closed_winning_trade(patch_market_data):
    result = _run()
    assert result.summary.num_trades == 1
    trade = result.trades[0]
    # spread jumps from 20bp -> 45bp: z > 0 -> bet on narrowing -> short direction
    assert trade.direction == -1
    assert trade.entry_date == _WINDOW_DATES[10]
    assert trade.exit_date == _WINDOW_DATES[-1]
    assert trade.exit_reason == "exit"
    assert trade.pnl > 0
    assert result.summary.win_rate == 1.0
    assert result.summary.total_pnl == pytest.approx(result.points[-1].cumulative_pnl)
    assert result.summary.max_drawdown >= 0


def test_different_tenor_pair_is_sign_flipped(patch_market_data):
    result_13 = _run(short="1Y", long="3Y")
    result_31 = _run(short="3Y", long="1Y")
    assert result_13.points[0].spread_bp == pytest.approx(-result_31.points[0].spread_bp)


def test_unreachable_entry_threshold_yields_no_trades(patch_market_data):
    result = _run(entry_z=50.0, stop_z=100.0)
    assert result.trades == []
    assert result.summary.num_trades == 0
    assert result.summary.win_rate is None


def test_lookback_larger_than_available_history_is_safe(patch_market_data):
    result = _run(lookback=10_000)
    assert all(p.z_score is None for p in result.points)
    assert result.trades == []
    assert result.summary.num_trades == 0


def test_entry_and_exit_costs_are_charged_one_way_each(patch_market_data):
    result = _run(cost_bp=0.05)
    trade = result.trades[0]
    entry_point = next(p for p in result.points if p.valuation_date == trade.entry_date)
    exit_point = next(p for p in result.points if p.valuation_date == trade.exit_date)
    # entry day: no mark-to-market (position just opened), only the entry cost
    assert entry_point.daily_pnl == pytest.approx(-1_000_000.0 * 0.05)
    # exit day: mark-to-market on the last day's move, minus the exit cost
    exit_idx = result.points.index(exit_point)
    prior_spread = result.points[exit_idx - 1].spread_bp
    expected_mtm = trade.direction * 1_000_000.0 * (exit_point.spread_bp - prior_spread)
    assert exit_point.daily_pnl == pytest.approx(expected_mtm - 1_000_000.0 * 0.05)
