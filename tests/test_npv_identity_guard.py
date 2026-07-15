"""s11 T1 guard — the NPV = MtM + Theta identity, pinned per instrument and
at aggregate level.

The decomposition's contract (portfolio_analytics_service, dirty basis):

    NPV_T - NPV_{T-1} + settled_cash(close, T] == MtM + Theta   (± KRW 1)

per instrument and for every aggregate row, where NPV is the engine's dirty
(full price) NPV — the same figure /api/mtm reports and the same basis
_bond_pnl always used. `settled_cash` is exposed as `realized_cash` in the
payload so an external consumer can run this reconciliation too.

The missing-quotes half of the policy is pinned separately: with no as-of
quotes the identity must hold on the theta leg alone, and MtM must be None
(blank), never 0.0 — the API has to keep "unknown" and "zero" distinguishable.

Instruments covered: the 5M/6M/9M/1Y/7Y receive-fixed matrix (seasoned, so a
live fixing is consumed), a coupon-crossing swap (settled cash != 0 inside
(close, T]), a forward-start (pre-fixing) swap, and a schedulable bond.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from irs_pricer.core import ttl_cache
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services import portfolio_service
from irs_pricer.services.portfolio_analytics_service import PositionData

TOLERANCE_KRW = 1.0

_CLOSE = date(2026, 6, 29)   # Monday
_AS_OF = date(2026, 6, 30)   # next KR business day


def _snapshot(cd_rate: float = 0.0330, valuation_date: date = _CLOSE) -> MarketSnapshot:
    quotes = [
        RateQuote(1, 0.0328, tenor_months=6),
        RateQuote(1, 0.0310),
        RateQuote(2, 0.0305),
        RateQuote(3, 0.0302),
        RateQuote(5, 0.0305),
        RateQuote(10, 0.0325),
    ]
    return MarketSnapshot(valuation_date=valuation_date, cd_rate=cd_rate,
                          on_rate=0.0325, swap_quotes=quotes)


# A seasoned start ~3M back: the first period's F(R) has passed, so the matrix
# swaps genuinely consume a fixing from the store below (live-fixed, not stub).
_SEASONED_START = _CLOSE - timedelta(days=95)

# Decimal fixings covering every F(R) the seasoned swaps can ask for.
_FIXINGS = {_SEASONED_START - timedelta(days=n): 0.0331 for n in range(0, 8)}


def _matrix_swap(label: str, months: int) -> PositionData:
    return PositionData(
        instrument_type="irs", position_id=f"M-{label}", sector="IRS",
        book="MATRIX", start_date=_SEASONED_START,
        maturity_date=_SEASONED_START + timedelta(days=int(months * 30.44) + 95),
        notional=10_000_000_000.0, fixed_rate=0.0305, pay_fixed=False,
        float_spread=0.0,
    )


_MATRIX = {"5M": 5, "6M": 6, "9M": 9, "1Y": 12, "7Y": 84}


def _coupon_crossing_swap() -> PositionData:
    """Quarterly schedule paying exactly on T=2026-06-30 (same construction as
    test_portfolio_analytics_service._swap_paying_on_as_of): settled cash != 0."""
    return PositionData(
        instrument_type="irs", position_id="X-COUPON", sector="IRS",
        book="MATRIX", start_date=date(2025, 6, 27),
        maturity_date=date(2030, 6, 30),
        notional=10_000_000_000.0, fixed_rate=0.0305, pay_fixed=False,
        float_spread=0.0,
    )


def _prefixing_swap() -> PositionData:
    """Forward start: no fixing exists yet, every period prices off the forward."""
    return PositionData(
        instrument_type="irs", position_id="X-PREFIX", sector="IRS",
        book="MATRIX", start_date=_AS_OF + timedelta(days=14),
        maturity_date=_AS_OF + timedelta(days=14 + 365 * 2),
        notional=10_000_000_000.0, fixed_rate=0.0305, pay_fixed=False,
        float_spread=0.0,
    )


def _bond() -> PositionData:
    return PositionData(
        instrument_type="bond", position_id="B-GUARD", sector="국고채",
        book="BONDS", notional=1_000_000_000.0,
        evaluation_amount=1_010_000_000.0, remaining_days=800,
        tenor_bucket="3Y", entry_yield=3.10, mtm_yield=3.05, duration=2.7,
        pvbp=-270_000.0, issue_date=date(2023, 5, 10),
        maturity_date=date(2028, 9, 7), coupon_rate=3.125,
        payment_frequency=2, rating=None,
    )


def _positions() -> list[PositionData]:
    return ([_matrix_swap(label, m) for label, m in _MATRIX.items()]
            + [_coupon_crossing_swap(), _prefixing_swap(), _bond()])


def _pin_sources(monkeypatch, *, irs: bool, credit: bool, today_snapshot=None):
    monkeypatch.setattr(pas, "_source_dates", lambda: {
        pas._SOURCE_IRS: [_AS_OF] if irs else [],
        pas._SOURCE_CREDIT: [_AS_OF] if credit else [],
    })
    monkeypatch.setattr(pas, "_snapshot_or_none", lambda _d: today_snapshot)


@pytest.fixture(autouse=True)
def _clear():
    ttl_cache.clear()
    yield
    ttl_cache.clear()


def _independent_swap_marks(irs_positions, close_snap, today_snap):
    """NPV_{T-1}, NPV_T and settled cash straight from price_portfolio, with
    no reference to the decomposition at all. Dirty basis."""
    swaps = [pas._to_swap(p) for p in irs_positions]
    r_close = portfolio_service.price_portfolio(close_snap, swaps, _FIXINGS)
    rolled_today = pas._roll_quotes_to(today_snap, _AS_OF)
    r_today = portfolio_service.price_portfolio(rolled_today, swaps, _FIXINGS)
    cash = pas._realized_swap_cash(irs_positions, r_close.cashflows, _CLOSE, _AS_OF)
    return ([r.dirty_npv for r in r_close.position_results],
            [r.dirty_npv for r in r_today.position_results],
            cash)


def test_identity_per_instrument_with_full_quotes(monkeypatch):
    """|ΔNPV + cash - (mtm + theta)| <= KRW 1 for every swap in the set,
    including the coupon-crossing one (cash != 0) and the pre-fixing one."""
    today = _snapshot(cd_rate=0.0340, valuation_date=_AS_OF)
    _pin_sources(monkeypatch, irs=True, credit=True, today_snapshot=today)
    irs = [p for p in _positions() if p.instrument_type == "irs"]

    close_snap = _snapshot()
    rolled = pas._roll_quotes_to(close_snap, _AS_OF)
    legs, _ = pas._swap_pnl(irs, close_snap, rolled, today, _FIXINGS)

    v_close, v_today, cash = _independent_swap_marks(irs, close_snap, today)

    crossing_seen = False
    fixing_seen = False
    for p, leg, vc, vt, c in zip(irs, legs, v_close, v_today, cash):
        assert leg.mtm is not None, f"{p.position_id}: quotes exist, MtM must be known"
        residual = (vt - vc) + c - (leg.mtm + leg.theta)
        assert abs(residual) <= TOLERANCE_KRW, (
            f"{p.position_id}: ΔNPV+cash - (mtm+theta) = {residual:,.4f}"
        )
        assert leg.realized_cash == pytest.approx(c)
        if c != 0.0:
            crossing_seen = True
        if p.position_id.startswith("M-"):
            fixing_seen = True
    assert crossing_seen, "test set no longer contains a coupon-crossing swap"
    assert fixing_seen, "test set no longer contains a live-fixed swap"


def test_identity_at_aggregate_level_with_full_quotes(monkeypatch):
    """Same bound on every by_book row and the portfolio envelope, via the
    public entry point (bond included -- exercised on the real credit matrix,
    so it runs only when Data/ is present)."""
    from irs_pricer.config import DATA_DIR
    if not DATA_DIR.exists():
        pytest.skip("real Data/ workbooks not present")

    today = _snapshot(cd_rate=0.0340, valuation_date=_AS_OF)
    _pin_sources(monkeypatch, irs=True, credit=True, today_snapshot=today)
    positions = _positions()
    res = pas.build_book_daily_pnl(positions, _snapshot(), _FIXINGS)

    # Independent aggregate ΔNPV: swaps from price_portfolio, the bond from
    # the same value_bond legs _bond_pnl prices (nothing from the split).
    irs = [p for p in positions if p.instrument_type == "irs"]
    v_close, v_today, cash = _independent_swap_marks(irs, _snapshot(), today)
    d_swaps = sum(vt - vc + c for vc, vt, c in zip(v_close, v_today, cash))

    from irs_pricer.engine import bond_valuation
    b = _bond()
    y_close = pas._bond_market_yield(b, _CLOSE, b.maturity_date)
    y_today = pas._bond_market_yield(b, _AS_OF, b.maturity_date)
    kw = dict(asset_id=b.position_id, issue_date=b.issue_date,
              maturity_date=b.maturity_date, coupon_rate=b.coupon_rate,
              payment_frequency=b.payment_frequency, notional=b.notional)
    vb_close = bond_valuation.value_bond(market_yield=y_close, val_date=_CLOSE, **kw)
    vb_today = bond_valuation.value_bond(market_yield=y_today, val_date=_AS_OF, **kw).npv
    b_cash = sum(c.cashflow for c in vb_close.cashflows
                 if _CLOSE < c.payment_date <= _AS_OF and c.cashflow is not None)
    d_bond = vb_today - vb_close.npv + b_cash

    dp = res["daily_pnl"]
    assert dp["mtm_complete"] is True
    assert abs((d_swaps + d_bond) - dp["total"]) <= TOLERANCE_KRW
    for row in res["by_book"]:
        assert abs(row["total"] - (row["theta"] + row["mtm"])) <= TOLERANCE_KRW


def test_identity_holds_with_missing_quotes_and_blank_is_not_zero(monkeypatch):
    """Pre-open/missing-quotes case: MtM must be None (the API keeps blank and
    zero distinguishable), and the identity holds on the theta leg alone --
    theta == V(T, c_close) - V(close, c_close) + cash, dirty basis, KRW 1."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    positions = _positions()
    res = pas.build_book_daily_pnl(positions, _snapshot(), _FIXINGS)

    dp = res["daily_pnl"]
    assert dp["mtm"] is None and dp["mtm"] != 0.0
    assert dp["mtm_complete"] is False
    assert dp["total"] == pytest.approx(dp["theta"])
    for row in res["by_book"]:
        assert row["mtm"] is None

    # Theta-leg identity, independently reconstructed (no today curve exists).
    irs = [p for p in positions if p.instrument_type == "irs"]
    swaps = [pas._to_swap(p) for p in irs]
    close_snap = _snapshot()
    r_close = portfolio_service.price_portfolio(close_snap, swaps, _FIXINGS)
    rolled = pas._roll_quotes_to(close_snap, _AS_OF)
    r_rolled = portfolio_service.price_portfolio(rolled, swaps, _FIXINGS)
    cash = pas._realized_swap_cash(irs, r_close.cashflows, _CLOSE, _AS_OF)

    legs, _ = pas._swap_pnl(irs, close_snap, rolled, None, _FIXINGS)
    for p, leg, rc, rr, c in zip(irs, legs, r_close.position_results,
                                 r_rolled.position_results, cash):
        expected_theta = (rr.dirty_npv - rc.dirty_npv) + c
        assert abs(leg.theta - expected_theta) <= TOLERANCE_KRW, p.position_id
        assert leg.mtm is None


def test_theta_is_smooth_daily_carry_not_coupon_lumps(monkeypatch):
    """The economic point of the dirty basis: theta reads as one day's carry.
    On the clean basis the coupon-crossing swap's theta was carry-free between
    coupons; on the dirty basis it must stay carry-sized (orders of magnitude
    below the settled coupon), and the settled cash must be visible in
    realized_cash rather than silently inside theta."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    pos = _coupon_crossing_swap()
    res = pas.build_book_daily_pnl([pos], _snapshot(), _FIXINGS)

    row = res["by_book"][0]
    assert row["realized_cash"] != 0.0
    assert abs(row["theta"]) < abs(row["realized_cash"]), (
        "theta still looks like a detached coupon"
    )
