"""Bump-reval DV01 for the PnL-trace tooltip (npv_trace_service).

Replaces the fixed-leg annuity proxy pv_fixed_leg/(rate*1e4), which read ~2x
the true DV01 before a payment and kept reporting a full ~245k/bp after the
final fixing was set (~2000x; DIAG_PNL_TRACE.md section 6). The replacement
is the codebase's one DV01 definition (risk.py / compute_irs_pvbp): +1bp
single-sided parallel par bump, full re-bootstrap, fixings held constant,
DV01 = -(NPV_up - NPV_base), receive-fixed positive / pay-fixed negative.

Real-data anchors (the -491k -> -245k pre-reset halving and the post-final-
fixing collapse on the Run-B dates) live in the trace regression matrix
(test_pnl_trace_regression.py); these tests pin the definition on a
synthetic flat curve.
"""

from __future__ import annotations

import math
from datetime import date

import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.services.npv_trace_service import _bump_reval_dv01, _parallel_bumped

NOTIONAL = 10_000_000_000.0
FIXINGS = {date(2025, 4, 15): 0.0251, date(2025, 7, 15): 0.0251}


def _snapshot(valuation_date: date, rate: float = 0.025) -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=rate,
        swap_quotes=[RateQuote(t, rate) for t in (1, 2, 3, 5)],
    )


def _swap(pay_fixed: bool = True, fixed_rate: float = 0.03) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=0.5,
        notional=NOTIONAL,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        trade_date=date(2025, 4, 15),
        maturity_date=date(2025, 10, 15),
    )


def _dv01(swap: VanillaSwap, valuation_date: date) -> float:
    snapshot = _snapshot(valuation_date)
    base = value_booked_trade(swap, build_curve(snapshot), FIXINGS)
    return _bump_reval_dv01(swap, snapshot, base.dirty_npv, FIXINGS)


def test_parallel_bump_shifts_every_node():
    snap = _snapshot(date(2025, 5, 2))
    bumped = _parallel_bumped(snap)
    assert bumped.cd_rate == pytest.approx(snap.cd_rate + 1e-4)
    assert all(
        b.rate == pytest.approx(q.rate + 1e-4)
        for q, b in zip(snap.swap_quotes, bumped.swap_quotes)
    )


def test_sign_convention_and_antisymmetry():
    """Receive-fixed positive, pay-fixed negative, exact mirrors."""
    payer = _dv01(_swap(pay_fixed=True), date(2025, 5, 2))
    receiver = _dv01(_swap(pay_fixed=False), date(2025, 5, 2))
    assert payer < 0 < receiver
    assert receiver == pytest.approx(-payer, rel=1e-9)


def test_pre_reset_magnitude_is_a_swap_dv01_not_the_annuity_proxy():
    """10bn payer with one unfixed 3M period: a true DV01 sits around
    -N * 0.25 * 1e-4 = -250k/bp. The old proxy read the full remaining fixed
    annuity (~-460k here); the bump-reval figure must be well below it."""
    dv01 = _dv01(_swap(), date(2025, 5, 2))
    assert -400_000 < dv01 < -100_000


def test_post_final_fixing_dv01_collapses_to_discount_risk():
    """After F(final reset) both legs are known cashflows -- only residual
    discount sensitivity remains (the diagnosis measured ~-108/bp there; the
    proxy kept reporting ~-245k)."""
    pre = _dv01(_swap(), date(2025, 5, 2))
    post = _dv01(_swap(), date(2025, 7, 17))
    assert abs(post) < 20_000
    assert abs(post) < abs(pre) / 20


def test_dv01_decays_with_remaining_maturity():
    early = _dv01(_swap(), date(2025, 5, 2))
    late = _dv01(_swap(), date(2025, 7, 17))
    assert abs(late) < abs(early)


def test_zero_fixed_rate_swap_has_finite_dv01():
    """The annuity proxy 0/0-special-cased fixed_rate == 0 to 0.0; bump-reval
    just prices the (float-only-risk) position."""
    dv01 = _dv01(_swap(fixed_rate=0.0), date(2025, 5, 2))
    assert math.isfinite(dv01)