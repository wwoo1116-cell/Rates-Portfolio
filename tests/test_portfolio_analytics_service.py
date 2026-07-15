"""
Coverage for portfolio_analytics_service -- the three Home dashboard panels
(PVBP sensitivity / daily PnL by book / book summary), which had none.

Focus is the shared-delta cache and the assumptions its key depends on, since
that cache is what collapses three identical repricings per dashboard load
into one.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.core import ttl_cache
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services import portfolio_service
from irs_pricer.services.portfolio_analytics_service import PositionData

_VALUATION_DATE = date(2026, 6, 29)


def _snapshot(cd_rate: float = 0.0330) -> MarketSnapshot:
    quotes = [
        RateQuote(1, 0.0328, tenor_months=6),
        RateQuote(1, 0.0310),
        RateQuote(2, 0.0305),
        RateQuote(3, 0.0302),
        RateQuote(5, 0.0305),
        RateQuote(10, 0.0325),
    ]
    return MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=cd_rate,
                          on_rate=0.0325, swap_quotes=quotes)


def _irs(position_id: str, book: str = "Book A", sector: str = "IRS") -> PositionData:
    return PositionData(
        instrument_type="irs",
        position_id=position_id,
        sector=sector,
        book=book,
        start_date=date(2025, 6, 25),
        maturity_date=date(2030, 6, 25),
        notional=1_000_000_000.0,
        fixed_rate=0.0305,
        pay_fixed=True,
        float_spread=0.0,
    )


def _bond(position_id: str, book: str = "Book A", sector: str = "국고채") -> PositionData:
    return PositionData(
        instrument_type="bond",
        position_id=position_id,
        sector=sector,
        book=book,
        notional=1_000_000_000.0,
        evaluation_amount=1_010_000_000.0,
        remaining_days=800,
        tenor_bucket="3Y",
        entry_yield=3.10,
        mtm_yield=3.05,
        duration=2.7,
        pvbp=-270_000.0,
    )


@pytest.fixture(autouse=True)
def _clear():
    ttl_cache.clear()
    yield
    ttl_cache.clear()


def test_delta_is_independent_of_fixings():
    """Pins the _shared_delta cache-key contract.

    The key deliberately omits `fixings` because price_portfolio_delta prices
    sensitivities off the curve alone and ignores it. If that ever stops being
    true, the key becomes wrong -- two different fixing sets would collide on
    one cached delta -- and this test is what says so.
    """
    snapshot = _snapshot()
    swaps = [pas._to_swap(_irs("P1"))]

    a = portfolio_service.price_portfolio_delta(snapshot, swaps, {})
    b = portfolio_service.price_portfolio_delta(
        snapshot, swaps, {date(2026, 6, 26): 0.99, date(2026, 6, 25): 0.01}
    )
    assert a.total_delta == b.total_delta, (
        "price_portfolio_delta now depends on fixings -- _shared_delta's cache "
        "key must include a fixings fingerprint"
    )


def test_shared_delta_is_computed_once_across_the_three_panels(monkeypatch):
    """The dashboard fires all three panels at one snapshot+portfolio. The
    expensive delta must be priced once, not three times."""
    calls = {"n": 0}
    real = portfolio_service.price_portfolio_delta

    def counting(snapshot, swaps, fixings):
        calls["n"] += 1
        return real(snapshot, swaps, fixings)

    monkeypatch.setattr(portfolio_service, "price_portfolio_delta", counting)

    positions = [_irs("P1"), _irs("P2"), _bond("B1")]
    snapshot = _snapshot()

    pas.build_pvbp_sensitivity(positions, snapshot, {})
    pas.build_book_summary(positions, snapshot, {})
    assert calls["n"] == 1, f"delta repriced {calls['n']}x for one dashboard load"


def test_shared_delta_reprices_when_the_curve_moves(monkeypatch):
    """The flip side: the cache is content-addressed, so a moved quote must
    miss rather than serve yesterday's risk."""
    calls = {"n": 0}
    real = portfolio_service.price_portfolio_delta

    def counting(snapshot, swaps, fixings):
        calls["n"] += 1
        return real(snapshot, swaps, fixings)

    monkeypatch.setattr(portfolio_service, "price_portfolio_delta", counting)

    positions = [_irs("P1")]
    pas.build_pvbp_sensitivity(positions, _snapshot(cd_rate=0.0330), {})
    pas.build_pvbp_sensitivity(positions, _snapshot(cd_rate=0.0331), {})
    assert calls["n"] == 2, "a 1bp CD move must invalidate the cached delta"


def test_shared_delta_reprices_when_a_position_changes(monkeypatch):
    calls = {"n": 0}
    real = portfolio_service.price_portfolio_delta

    def counting(snapshot, swaps, fixings):
        calls["n"] += 1
        return real(snapshot, swaps, fixings)

    monkeypatch.setattr(portfolio_service, "price_portfolio_delta", counting)

    snapshot = _snapshot()
    pas.build_pvbp_sensitivity([_irs("P1")], snapshot, {})

    bigger = _irs("P1")
    bigger.notional = 2_000_000_000.0
    pas.build_pvbp_sensitivity([bigger], snapshot, {})
    assert calls["n"] == 2, "resizing a position must invalidate the cached delta"


def test_pvbp_sensitivity_totals_reconcile():
    positions = [_irs("P1"), _bond("B1")]
    rows = pas.build_pvbp_sensitivity(positions, _snapshot(), {})

    total_row = [r for r in rows if r["sector"] == "합계"]
    assert len(total_row) == 1
    sector_rows = [r for r in rows if r["sector"] != "합계"]
    assert total_row[0]["total"] == pytest.approx(sum(r["total"] for r in sector_rows))


def test_book_summary_needs_no_daily_pnl_argument():
    """build_book_summary used to take a daily_pnl_by_book it never read, which
    forced the frontend to await /book-daily-pnl before it could even ask for
    this panel. It's a two-argument call now; the panels are independent."""
    rows = pas.build_book_summary([_irs("P1"), _bond("B1")], _snapshot(), {})
    assert [r["book"] for r in rows] == ["Book A"]
    assert rows[0]["totalEvaluationAmount"] == pytest.approx(1_010_000_000.0)


def test_book_summary_hedged_duration_nets_irs_against_bonds():
    """A receive-fixed swap should offset a bond's negative PVBP, so net
    hedged duration must sit below the bond-only figure."""
    bond_only = pas.build_book_summary([_bond("B1")], _snapshot(), {})[0]

    receiver = _irs("P1")
    receiver.pay_fixed = False
    hedged = pas.build_book_summary([_bond("B1"), receiver], _snapshot(), {})[0]

    assert hedged["hedgedDuration"] > bond_only["hedgedDuration"]
