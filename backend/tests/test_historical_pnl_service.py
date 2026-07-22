from datetime import date

import pytest

from irs_pricer.core.errors import NonBusinessDayError
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import historical_pnl_service, market_data_service

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]

# Synthetic business-day window (skips the 2024-01-06/07 weekend); the actual
# calendar validity of these dates doesn't matter since list_available_dates
# and load_snapshot are monkeypatched below -- only the service's own
# active-window/baseline logic is under test, not real market data.
_WINDOW_DATES = [
    date(2024, 1, 2),
    date(2024, 1, 3),
    date(2024, 1, 4),
    date(2024, 1, 5),
    date(2024, 1, 8),
    date(2024, 1, 9),
    date(2024, 1, 10),
]


def _fake_snapshot(valuation_date: date) -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=0.0292,
        swap_quotes=[RateQuote(t, r) for t, r in _QUOTES],
    )


def _swap(trade_date: date, maturity_date: date, notional: float = 10_000_000, fixed_rate: float = 0.0270) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=0,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=True,
        trade_date=trade_date,
        maturity_date=maturity_date,
    )


@pytest.fixture
def patch_market_data(monkeypatch):
    monkeypatch.setattr(market_data_service, "list_available_dates", lambda: list(_WINDOW_DATES))
    monkeypatch.setattr(market_data_service, "load_fixings", lambda: {})
    monkeypatch.setattr(market_data_service, "load_snapshot", _fake_snapshot)


def test_full_window_active_position_appears_on_every_date(patch_market_data):
    swap = _swap(date(2024, 1, 2), date(2024, 1, 10))
    result = historical_pnl_service.compute_historical_pnl(
        [("pos-A", swap)], date(2024, 1, 2), date(2024, 1, 10)
    )
    assert [p.valuation_date for p in result.points] == _WINDOW_DATES
    assert all(p.active_position_ids == ["pos-A"] for p in result.points)
    assert result.skipped_dates == []
    assert result.baseline_date == _WINDOW_DATES[0]
    assert result.points[0].cumulative_pnl == 0.0


def test_position_excluded_before_its_trade_date(patch_market_data):
    early = _swap(date(2024, 1, 2), date(2024, 1, 10))
    late = _swap(date(2024, 1, 5), date(2024, 1, 10))  # starts mid-window
    result = historical_pnl_service.compute_historical_pnl(
        [("early", early), ("late", late)], date(2024, 1, 2), date(2024, 1, 10)
    )
    by_date = {p.valuation_date: p.active_position_ids for p in result.points}
    assert by_date[date(2024, 1, 4)] == ["early"]
    assert set(by_date[date(2024, 1, 5)]) == {"early", "late"}


def test_position_excluded_after_its_maturity_date(patch_market_data):
    long_lived = _swap(date(2024, 1, 2), date(2024, 1, 10))
    short_lived = _swap(date(2024, 1, 2), date(2024, 1, 4))  # matures mid-window
    result = historical_pnl_service.compute_historical_pnl(
        [("long", long_lived), ("short", short_lived)], date(2024, 1, 2), date(2024, 1, 10)
    )
    by_date = {p.valuation_date: p.active_position_ids for p in result.points}
    assert set(by_date[date(2024, 1, 4)]) == {"long", "short"}
    assert by_date[date(2024, 1, 5)] == ["long"]


def test_explicit_baseline_date_has_zero_cumulative_pnl(patch_market_data):
    swap = _swap(date(2024, 1, 2), date(2024, 1, 10))
    result = historical_pnl_service.compute_historical_pnl(
        [("pos-A", swap)], date(2024, 1, 2), date(2024, 1, 10), baseline_date=date(2024, 1, 5)
    )
    assert result.baseline_date == date(2024, 1, 5)
    baseline_point = next(p for p in result.points if p.valuation_date == date(2024, 1, 5))
    assert baseline_point.cumulative_pnl == 0.0


def test_date_with_no_active_positions_is_zero_and_skipped(patch_market_data):
    swap = _swap(date(2024, 1, 8), date(2024, 1, 10))  # only active for the last 3 dates
    result = historical_pnl_service.compute_historical_pnl(
        [("pos-A", swap)], date(2024, 1, 2), date(2024, 1, 10)
    )
    early_dates = _WINDOW_DATES[:4]  # 01-02..01-05, all before pos-A's trade_date
    assert result.skipped_dates == early_dates
    for p in result.points:
        if p.valuation_date in early_dates:
            assert p.net_npv == 0.0
            assert p.active_position_ids == []
    # series stays date-complete over the whole window despite the gap
    assert [p.valuation_date for p in result.points] == _WINDOW_DATES


def test_stray_holiday_in_available_dates_is_omitted_not_zero_filled(patch_market_data, monkeypatch):
    """Regression: list_available_dates() can report a date (because the raw
    data file has a row for it, e.g. a stray year-end row) that the KRX
    calendar itself rejects as a holiday. load_snapshot() then raises
    NonBusinessDayError. Positions can genuinely be active that day, so a
    zero-filled point would be a *fabricated* NPV, not a correct one --
    that previously produced a fake crash-to-zero-and-back in the series
    right around year boundaries. The date must instead be OMITTED from
    points entirely (still recorded in skipped_dates), and must not corrupt
    neighboring dates' own net_npv values."""

    def flaky_snapshot(valuation_date: date) -> MarketSnapshot:
        if valuation_date == date(2024, 1, 4):
            raise NonBusinessDayError(valuation_date, "공휴일")
        return _fake_snapshot(valuation_date)

    monkeypatch.setattr(market_data_service, "load_snapshot", flaky_snapshot)

    swap = _swap(date(2024, 1, 2), date(2024, 1, 10))
    result = historical_pnl_service.compute_historical_pnl(
        [("pos-A", swap)], date(2024, 1, 2), date(2024, 1, 10)
    )

    assert date(2024, 1, 4) in result.skipped_dates
    remaining_dates = [d for d in _WINDOW_DATES if d != date(2024, 1, 4)]
    assert [p.valuation_date for p in result.points] == remaining_dates
    # neighboring dates still price normally through the real pricing path
    # (not the fabricated-zero-point fallback) -- position stays active
    assert all(p.active_position_ids == ["pos-A"] for p in result.points)


def test_baseline_date_outside_window_raises(patch_market_data):
    swap = _swap(date(2024, 1, 2), date(2024, 1, 10))
    with pytest.raises(ValueError):
        historical_pnl_service.compute_historical_pnl(
            [("pos-A", swap)], date(2024, 1, 2), date(2024, 1, 10), baseline_date=date(2023, 12, 31)
        )
