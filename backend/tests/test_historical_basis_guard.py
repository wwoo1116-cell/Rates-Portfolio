"""s13 T1 guard — historical/trace P&L series on the dirty+cash basis.

Extends the s11 identity guard (tests/test_npv_identity_guard.py, live
decomposition) to the historical pipeline:

  * per-day, inside the trace pipeline:
        daily_pnl == ΔNPV(dirty) + settled_cash   (± KRW 1)
    and, on real data, daily_pnl == MtM + Theta from the Home decomposition
    (_swap_pnl) for the same instrument and adjacent-business-day pair;
  * trace cumulative endpoint == Σ of the decomposed daily P&L over the window;
  * continuity: a payment date inside the window must NOT crater the series by
    the settled amount (no sawtooth), and a swap maturing mid-window must not
    cliff the portfolio cumulative by its final dirty NPV (no orphaned accrual);
  * the ad-hoc and DB-cached trace variants sit on the SAME basis.

Synthetic-market tests mirror test_npv_trace_service_cache.py's patching so
they need no Data/ workbooks; the Home-vs-trace reconciliation runs on the real
store and skips when it is absent.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from irs_pricer.config import DATA_DIR
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.db import trade_repository
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import settled_cash_between
from irs_pricer.engine.quant_engine import next_kr_business_day
from irs_pricer.services import historical_pnl_service, market_data_service, npv_trace_service
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services import portfolio_service

TOLERANCE_KRW = 1.0

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]


def _fake_snapshot(valuation_date: date) -> MarketSnapshot:
    return MarketSnapshot(valuation_date=valuation_date, cd_rate=0.0292,
                          swap_quotes=[RateQuote(t, r) for t, r in _QUOTES])


def _swap(trade_date: date, years: int = 2, pay_fixed: bool = False) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=years, notional=10_000_000_000.0, fixed_rate=0.0270,
        pay_fixed=pay_fixed, trade_date=trade_date,
        maturity_date=trade_date + timedelta(days=365 * years),
    )


def _business_days_around(anchor: date, before: int, after: int) -> list[date]:
    """`before` KR business days strictly before `anchor`(-ish), then every one
    through `after` days past it — a deterministic window bracketing a date."""
    days: list[date] = []
    d = anchor - timedelta(days=before * 3 + 7)
    while len(days) == 0 or days[-1] < anchor + timedelta(days=after * 3):
        d = next_kr_business_day(d)
        days.append(d)
    start_idx = max(0, next(i for i, x in enumerate(days) if x >= anchor) - before)
    return days[start_idx:]


def _crossing_window(swap: VanillaSwap) -> list[date]:
    """6+ business days bracketing the swap's second payment date."""
    pay_dates = swap.to_irs_trade(swap.maturity_date).pay_dates
    anchor = pay_dates[1]
    return _business_days_around(anchor, before=3, after=3)


@pytest.fixture
def seasoned_swap() -> VanillaSwap:
    return _swap(date(2024, 1, 3))


@pytest.fixture
def window(seasoned_swap) -> list[date]:
    return _crossing_window(seasoned_swap)


@pytest.fixture
def fixings(window) -> dict[date, float]:
    """Decimal CD prints covering every possible F(R) around the window."""
    first = date(2024, 1, 1)
    n = (window[-1] - first).days + 1
    return {first + timedelta(days=i): 0.0285 for i in range(n)}


@pytest.fixture
def patch_market(monkeypatch, window, fixings):
    monkeypatch.setattr(market_data_service, "list_available_dates", lambda: list(window))
    monkeypatch.setattr(market_data_service, "load_fixings", lambda: dict(fixings))
    monkeypatch.setattr(market_data_service, "load_snapshot", _fake_snapshot)


# ---------------------------------------------------------------------------
# per-day identity + continuity, ad-hoc trace
# ---------------------------------------------------------------------------

def test_adhoc_trace_daily_is_dirty_delta_plus_settled_cash(patch_market, seasoned_swap, window, fixings):
    """Per-day, inside the pipeline: daily == Δdirty + settled cash, KRW 1."""
    res = npv_trace_service.compute_npv_trace(seasoned_swap, window[0], window[-1])
    assert len(res.points) == len(window)

    crossing_seen = False
    for prev, cur in zip(res.points, res.points[1:]):
        cash = settled_cash_between(seasoned_swap, fixings, prev.valuation_date, cur.valuation_date)
        expected = (cur.dirty_npv - prev.dirty_npv) + cash
        assert abs(cur.daily_pnl - expected) <= TOLERANCE_KRW, cur.valuation_date
        if cash != 0.0:
            crossing_seen = True
            # continuity: the settled flow must not crater the day's P&L —
            # the day reads as carry/market move, not as a detached coupon.
            assert abs(cur.daily_pnl) < abs(cash), (
                f"{cur.valuation_date}: daily {cur.daily_pnl:,.0f} still looks "
                f"like the settled coupon ({cash:,.0f})"
            )
    assert crossing_seen, "window no longer brackets a payment date"


def test_adhoc_trace_cumulative_endpoint_is_sum_of_daily(patch_market, seasoned_swap, window):
    res = npv_trace_service.compute_npv_trace(seasoned_swap, window[0], window[-1])
    assert res.points[0].daily_pnl == 0.0
    assert res.points[-1].cumulative_pnl == pytest.approx(
        sum(p.daily_pnl for p in res.points), abs=1e-6
    )


# ---------------------------------------------------------------------------
# DB-cached variant sits on the same basis
# ---------------------------------------------------------------------------

def test_for_trade_variant_matches_adhoc_series(db, patch_market, seasoned_swap, window):
    trade = trade_repository.create(
        db, external_position_id="s13-guard", trade_date=seasoned_swap.trade_date,
        start_date=seasoned_swap.trade_date, maturity_date=seasoned_swap.maturity_date,
        notional=seasoned_swap.notional, fixed_rate=seasoned_swap.fixed_rate,
        pay_fixed=seasoned_swap.pay_fixed,
    )
    adhoc = npv_trace_service.compute_npv_trace(seasoned_swap, window[0], window[-1])
    cached = npv_trace_service.compute_npv_trace_for_trade(
        db, trade.trade_id, window[0], window[-1]
    )
    assert [p.valuation_date for p in cached.points] == [p.valuation_date for p in adhoc.points]
    for a, c in zip(adhoc.points, cached.points):
        assert abs(c.daily_pnl - a.daily_pnl) <= TOLERANCE_KRW, c.valuation_date
        assert abs(c.cumulative_pnl - a.cumulative_pnl) <= TOLERANCE_KRW, c.valuation_date
    assert cached.entry_npv == pytest.approx(adhoc.entry_npv)


# ---------------------------------------------------------------------------
# portfolio historical series: telescoping + no maturity cliff
# ---------------------------------------------------------------------------

def test_historical_pnl_cumulative_telescopes_to_endpoints(patch_market, seasoned_swap, window, fixings):
    """Independent reconstruction: the running series must collapse to
    (dirty_last - dirty_first) + total settled cash, straight from
    price_portfolio with no reference to the series code."""
    positions = [("p1", seasoned_swap)]
    res = historical_pnl_service.compute_historical_pnl(positions, window[0], window[-1])

    def dirty_at(d: date) -> float:
        r = portfolio_service.price_portfolio(_fake_snapshot(d), positions, dict(fixings))
        return sum(x.dirty_npv for x in r.position_results)

    cash = settled_cash_between(seasoned_swap, fixings, window[0], window[-1])
    assert cash != 0.0, "window no longer brackets a payment date"
    expected = (dirty_at(window[-1]) - dirty_at(window[0])) + cash
    assert abs(res.points[-1].cumulative_pnl - expected) <= TOLERANCE_KRW
    assert res.points[0].cumulative_pnl == 0.0


def test_historical_pnl_no_cliff_when_a_swap_matures_mid_window(patch_market, monkeypatch, fixings, window):
    """A swap maturing inside the window leaves the active set; its final
    settlement is cash, not vanished value. The old clean-basis series cliffed
    by the full final NPV here."""
    maturing = VanillaSwap(
        tenor_years=1, notional=10_000_000_000.0, fixed_rate=0.0270, pay_fixed=False,
        trade_date=date(2024, 1, 3), maturity_date=window[2],
    )
    final_cash = settled_cash_between(maturing, fixings, window[1], window[-1])
    assert final_cash != 0.0, "fixture broken: no final settlement in window"

    res = historical_pnl_service.compute_historical_pnl([("m1", maturing)], window[0], window[-1])
    by_date = {p.valuation_date: p for p in res.points}
    before = by_date[window[1]].cumulative_pnl
    after = res.points[-1].cumulative_pnl
    # once matured nothing accrues or settles further: the series is flat
    assert res.points[-1].cumulative_pnl == pytest.approx(by_date[window[3]].cumulative_pnl, abs=1e-6)
    assert abs(after - before) < abs(final_cash), (
        f"cumulative still cliffs across maturity: {before:,.0f} -> {after:,.0f} "
        f"(final settlement {final_cash:,.0f})"
    )


# ---------------------------------------------------------------------------
# real data: trace daily == Home Daily PnL decomposition (MtM + Theta)
# ---------------------------------------------------------------------------

def _adjacent_pairs(dates: list[date], n: int) -> list[tuple[date, date]]:
    pairs = [(a, b) for a, b in zip(dates, dates[1:]) if next_kr_business_day(a) == b]
    return pairs[-n:]


@pytest.mark.skipif(not DATA_DIR.exists(), reason="real Data/ workbooks not present")
def test_trace_daily_matches_home_decomposition_on_real_data():
    """Task 1.5: for the same instrument and as-of, the trace's daily P&L and
    the Home Daily PnL total (theta + mtm, s11 dirty basis) must agree to KRW 1
    on every adjacent business-day pair sampled."""
    dates = market_data_service.list_available_dates()
    pairs = _adjacent_pairs(dates, 5)
    if not pairs:
        pytest.skip("no adjacent business-day pair in the store")

    swap = _swap(pairs[0][0] - timedelta(days=95))
    pos = pas.PositionData(
        instrument_type="irs", position_id="S13-RECON", sector="IRS", book="G",
        start_date=swap.trade_date, maturity_date=swap.maturity_date,
        notional=swap.notional, fixed_rate=swap.fixed_rate, pay_fixed=swap.pay_fixed,
        float_spread=0.0,
    )
    fixings = market_data_service.load_fixings()
    trace = npv_trace_service.compute_npv_trace(swap, pairs[0][0], pairs[-1][1])
    daily_by_date = {p.valuation_date: p.daily_pnl for p in trace.points}

    for close_d, as_of in pairs:
        close_snap = market_data_service.load_snapshot(close_d)
        today_snap = market_data_service.load_snapshot(as_of)
        rolled = pas._roll_quotes_to(close_snap, as_of)
        legs, _ = pas._swap_pnl([pos], close_snap, rolled, today_snap, fixings)
        leg = legs[0]
        assert leg.mtm is not None
        assert abs(daily_by_date[as_of] - (leg.mtm + leg.theta)) <= TOLERANCE_KRW, (
            f"{close_d} -> {as_of}: trace {daily_by_date[as_of]:,.2f} != "
            f"mtm+theta {(leg.mtm + leg.theta):,.2f}"
        )
