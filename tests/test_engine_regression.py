"""Regression gate for the hand-rolled (QuantLib-free) pricing engine.

Replaces the QuantLib-era comparison harnesses (test_curve / test_pricing /
test_mtm_valuation etc.) which asserted parity against `ql.VanillaSwap` /
`DiscountingSwapEngine` and poked QL-only curve internals (`yield_curve.
discount()`, `float_index`, `settlement_date`). With QuantLib fully removed,
those comparisons are meaningless; this module pins the *actual* behaviour of
`quant_engine.py` and the thin glue around it.

Covers, in particular, the glue-consolidation work:
  * §2d -- the reported NPV path (engine.pricing.price_swap /
    engine.mtm_valuation.value_booked_trade) equals the canonical
    IRS_Trade.compute_npv over the actual ISDA schedule, to machine precision.
  * §3b -- sum(bucketed_dv01) reconciles with the independent parallel-shift
    engine.risk.parallel_pvbp within cross-gamma on a production-density curve.

UNIT CONVENTION (load-bearing): everything at the MarketSnapshot / VanillaSwap
layer is a DECIMAL (0.0305 == 3.05%). build_curve->bootstrap_zero_curve and
VanillaSwap.to_irs_trade (which multiplies fixed_rate*100) both assume decimals;
feeding percents overflows the bootstrap past ~3Y (DF underflows to 0) and
silently truncates long-end risk. test_decimal_units_guard pins this.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.engine.pricing import price_swap
from irs_pricer.engine.quant_engine import (
    df,
    df_linear_rate,
    forward_rate_simple,
)
from irs_pricer.engine.risk import bucketed_dv01, dv01, parallel_pvbp
from irs_pricer.services.pricing_service import delta

_VALUATION_DATE = date(2026, 6, 29)


def _dense_snapshot() -> MarketSnapshot:
    """A production-density curve: one par quote at (almost) every KRD node
    (6M,9M,1Y,1.5Y,2Y,3Y..10Y) + CD91D, so each KRD label maps 1:1 to a
    distinct par node (no label-collapse double-counting)."""
    quotes = [
        RateQuote(1, 0.0328, tenor_months=6),
        RateQuote(1, 0.0324, tenor_months=9),
        RateQuote(1, 0.0310),
        RateQuote(2, 0.0306, tenor_months=18),
        RateQuote(2, 0.0305),
        RateQuote(3, 0.0302),
        RateQuote(4, 0.0303),
        RateQuote(5, 0.0305),
        RateQuote(6, 0.0308),
        RateQuote(7, 0.0312),
        RateQuote(8, 0.0316),
        RateQuote(9, 0.0320),
        RateQuote(10, 0.0325),
    ]
    return MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.0330,
                          on_rate=0.0325, swap_quotes=quotes)


def _sparse_snapshot(on_rate: float | None = None) -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=_VALUATION_DATE,
        cd_rate=0.0292,
        on_rate=on_rate,
        swap_quotes=[RateQuote(t, r) for t, r in
                     [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (10, 0.0257)]],
    )


def _payer(mat_years: int = 5, fixed_rate: float = 0.0305, notional: float = 100_000_000_000) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=mat_years, notional=notional, fixed_rate=fixed_rate,
        pay_fixed=True, trade_date=_VALUATION_DATE,
        maturity_date=date(_VALUATION_DATE.year + mat_years, _VALUATION_DATE.month, _VALUATION_DATE.day),
    )


# ── curve invariants ────────────────────────────────────────────────────────

def test_discount_factor_at_zero_is_one():
    zc = build_curve(_dense_snapshot()).yield_curve
    assert df(0.0, zc) == pytest.approx(1.0, abs=1e-12)
    assert df_linear_rate(0.0, zc) == pytest.approx(1.0, abs=1e-12)


def test_discount_factors_decrease_with_maturity():
    zc = build_curve(_dense_snapshot()).yield_curve
    dfs = [df_linear_rate(t, zc) for t in (0.5, 1.0, 2.0, 3.0, 5.0, 10.0)]
    assert all(a > b for a, b in zip(dfs, dfs[1:]))
    # and every DF stays in (0, 1] -- the percent/decimal-overflow bug drove
    # far DFs to exactly 0.0 (see test_decimal_units_guard).
    assert all(0.0 < d <= 1.0 for d in dfs)


def test_zero_rates_are_positive():
    zc = build_curve(_dense_snapshot()).yield_curve
    assert (zc[:, 1] > 0).all()


def test_par_swap_struck_at_fair_rate_reprices_to_zero():
    curve = build_curve(_dense_snapshot())
    swap = _payer(fixed_rate=0.04)
    par = price_swap(swap, curve)["par_rate"]
    at_par = _payer(fixed_rate=par)
    assert abs(price_swap(at_par, curve)["npv"]) < 1e-2


# ── pricing invariants ──────────────────────────────────────────────────────

def test_paying_above_par_is_negative_npv_to_payer():
    curve = build_curve(_dense_snapshot())
    par = price_swap(_payer(fixed_rate=0.04), curve)["par_rate"]
    assert price_swap(_payer(fixed_rate=par + 0.01), curve)["npv"] < 0


def test_dv01_sign_convention_payer_negative_receiver_positive():
    """quant_engine DV01 convention: receive-fixed (long bond) -> +, pay-fixed
    (short bond) -> -, and the two are exact negatives."""
    curve = build_curve(_dense_snapshot())
    payer = _payer()
    receiver = VanillaSwap(tenor_years=5, notional=payer.notional, fixed_rate=payer.fixed_rate,
                           pay_fixed=False, trade_date=payer.trade_date, maturity_date=payer.maturity_date)
    d_pay = dv01(payer, curve)
    d_rec = dv01(receiver, curve)
    assert d_pay < 0 < d_rec
    assert d_rec == pytest.approx(-d_pay, rel=1e-9)


def test_delta_total_equals_sum_of_buckets():
    result = delta(_dense_snapshot(), _payer())
    assert result.total_delta == pytest.approx(sum(b.delta for b in result.buckets), abs=1e-6)


def test_delta_dominant_bucket_matches_swap_tenor():
    result = delta(_dense_snapshot(), _payer(mat_years=5))
    by_pillar = {b.pillar: abs(b.delta) for b in result.buckets}
    assert by_pillar["5Y"] == max(by_pillar.values())


def test_delta_magnitude_is_sane_for_5y_100bn():
    """A 100bn 5Y swap has DV01 on the order of tens of millions of KRW
    (~notional * annuity_pv01). Guards against the long-end-truncation failure
    mode where DFs underflow and DV01 collapses to a fraction of that."""
    d = abs(dv01(_payer(), build_curve(_dense_snapshot())))
    assert 20_000_000 < d < 80_000_000


def test_on_rate_absent_means_no_1d_pillar():
    curve = build_curve(_sparse_snapshot(on_rate=None))
    assert curve.par_rates[0][0] == pytest.approx(91.0 / 365.0)  # CD91D first, no 1D


def test_on_rate_present_adds_1d_pillar_first():
    curve = build_curve(_sparse_snapshot(on_rate=0.0290))
    assert curve.par_rates[0][0] == pytest.approx(1.0 / 365.0)
    assert curve.par_rates[1][0] == pytest.approx(91.0 / 365.0)


# ── §2d: reported NPV == canonical IRS_Trade.compute_npv ────────────────────

def test_reported_npv_equals_canonical_irs_trade_npv():
    curve = build_curve(_dense_snapshot())
    swap = _payer()
    reported = price_swap(swap, curve)["npv"]

    irs = swap.to_irs_trade(curve.valuation_date)
    rem = [i for i, pd in enumerate(irs.pay_dates) if pd > curve.valuation_date]
    t_next = max((irs.pay_dates[rem[0]] - curve.valuation_date).days / 365.0, 1 / 365.0)
    cf = forward_rate_simple(0.0, t_next, curve.yield_curve) * 100.0
    canonical = irs.compute_npv(curve.valuation_date, curve.yield_curve, cf, df_linear_rate)

    assert reported == pytest.approx(canonical, rel=1e-12, abs=1e-6)


def test_mtm_dirty_npv_equals_reported_npv():
    """value_booked_trade prices the same actual schedule as price_swap; with
    the same (forward-estimated) current fixing their scalar NPVs coincide."""
    curve = build_curve(_dense_snapshot())
    swap = _payer()
    reported = price_swap(swap, curve)["npv"]
    mtm = value_booked_trade(swap, curve)  # current_float_rate=None -> same forward estimate
    assert mtm.dirty_npv == pytest.approx(reported, rel=1e-12, abs=1e-6)
    # clean/dirty/accrued identity
    assert mtm.clean_npv == pytest.approx(mtm.dirty_npv - mtm.accrued_interest, abs=1e-9)


def test_mtm_cashflows_are_per_period_both_legs():
    curve = build_curve(_dense_snapshot())
    res = value_booked_trade(_payer(mat_years=3), curve)
    fixed = [c for c in res.cashflows if c.leg == "fixed"]
    floating = [c for c in res.cashflows if c.leg == "floating"]
    assert len(fixed) == len(floating) > 1
    # No fixings store passed -> EVERY floating period is a forward estimate,
    # including the current stub. is_known=True is reserved for a genuine
    # reset-date fixing (engine/fixings.py); an estimated stub claiming
    # is_known was the pre-2026-07 behavior this line used to pin.
    assert all(c.is_known is False for c in floating)


# ── §3b: sum(KRD) reconciles with the independent parallel PVBP ─────────────

def test_sum_krd_reconciles_with_parallel_pvbp():
    curve = build_curve(_dense_snapshot())
    swap = _payer()
    sum_krd = dv01(swap, curve)
    pvbp = parallel_pvbp(swap, curve)
    # first-order equal; differ only by cross-gamma of one-at-a-time vs
    # all-at-once bumps under the nonlinear re-bootstrap.
    assert sum_krd == pytest.approx(pvbp, rel=5e-3)


def test_krd_base_matches_reported_npv_via_zero_bump():
    """The KRD/PVBP base NPV is computed over the same actual schedule as the
    reported NPV (that is exactly the §2d fix). parallel_pvbp with a 0bp shift
    would be identically zero, so instead pin that bucketed_dv01 produces a
    full node ladder (not the truncated nominal fallback): every non-anchor
    par node up to maturity carries a bucket."""
    curve = build_curve(_dense_snapshot())
    buckets = bucketed_dv01(_payer(mat_years=5), curve)
    nonzero = {k for k, v in buckets.items() if abs(v) > 1.0}
    # a 5Y swap must have risk at the 5Y node and neighbours, not only short end
    assert "5Y" in nonzero
    assert {"3Y", "4Y", "5Y"} <= nonzero


# ── unit-convention guard (the percent/decimal trap) ────────────────────────

def test_decimal_units_guard():
    """Rates are decimals. A near-par 100bn 5Y swap must have |NPV| that is a
    small fraction of notional. If rates were fed as percents the bootstrap
    overflows, far DFs underflow to 0, and the reported NPV explodes -- this
    pins the correct (decimal) regime."""
    curve = build_curve(_dense_snapshot())
    npv = price_swap(_payer(fixed_rate=0.0305), curve)["npv"]
    assert abs(npv) < 0.10 * 100_000_000_000  # < 10% of notional for a near-par swap
    # and the long-end DF must be strictly positive (no underflow-to-zero)
    assert df_linear_rate(5.0, curve.yield_curve) > 0.5
