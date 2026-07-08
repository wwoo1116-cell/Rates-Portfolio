from datetime import date

import pytest

from irs_pricer.engine.curve import CurveBundle, build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.pricing import price_swap
from irs_pricer.engine.risk import curve_bump_scenarios, dv01
from irs_pricer.services.pricing_service import delta


from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.core.conventions import to_ql_date

def _snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=date(2026, 6, 29),
        cd_rate=0.0292,
        swap_quotes=[
            RateQuote(t, r) for t, r in [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (10, 0.0257)]
        ],
    )


def test_swap_at_par_rate_has_zero_npv():
    snapshot = _snapshot()
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        swap = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=0.04)
        par_rate = price_swap(swap, curve)["par_rate"]

        swap_at_par = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=par_rate)
        assert abs(price_swap(swap_at_par, curve)["npv"]) < 1e-2


def test_paying_above_par_rate_gives_negative_npv_to_payer():
    snapshot = _snapshot()
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        swap = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=0.04)
        par_rate = price_swap(swap, curve)["par_rate"]

        swap_above_par = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=par_rate + 0.01)
        assert price_swap(swap_above_par, curve)["npv"] < 0


def test_dv01_is_positive():
    snapshot = _snapshot()
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
        swap = VanillaSwap(tenor_years=5, notional=10_000_000, fixed_rate=0.04)
        assert dv01(swap, curve) > 0


def test_delta_total_equals_sum_of_buckets():
    snapshot = _snapshot()
    swap = VanillaSwap(tenor_years=5, notional=10_000_000_000, fixed_rate=0.04)
    result = delta(snapshot, swap)

    assert len(result.buckets) == len(snapshot.swap_quotes) + 1  # + CD91D pillar
    # total_delta IS the sum of the buckets by definition (see engine/risk.py's
    # module docstring for why there's no separate parallel-shift scenario).
    assert result.total_delta == pytest.approx(sum(b.delta for b in result.buckets), abs=1e-6)


def test_bumping_one_pillar_leaks_into_a_later_pillars_discount_factor():
    """Market-quote bump + full re-bootstrap intentionally leaks across
    pillars: a later instrument's own calibration equation depends on the
    earlier (now-bumped) discount factors, so bumping e.g. the 3Y quote also
    moves the solved discount factor at 5Y even though the 5Y quote itself
    was never touched -- see engine/risk.py's module docstring for why this
    leakage, despite being non-local, is the convention that matches the
    reference system's own key-rate ladder."""
    snapshot = _snapshot()
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        base = build_curve(snapshot)
        base_pillar_dates = dict(base.pillars)
        scenarios = dict(curve_bump_scenarios(snapshot))

        bumped_3y = scenarios["3Y"]
        base_df_5y = base.yield_curve.discount(base_pillar_dates["5Y"])
        bumped_df_5y = bumped_3y.yield_curve.discount(base_pillar_dates["5Y"])
        assert bumped_df_5y != base_df_5y


def test_delta_dominant_bucket_matches_swap_tenor():
    snapshot = _snapshot()
    swap = VanillaSwap(tenor_years=5, notional=10_000_000_000, fixed_rate=0.04)
    result = delta(snapshot, swap)

    by_pillar = {b.pillar: abs(b.delta) for b in result.buckets}
    assert by_pillar["5Y"] == max(by_pillar.values())


def test_on_rate_absent_means_no_1d_pillar():
    snapshot = _snapshot()
    assert snapshot.on_rate is None
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
    assert [label for label, _ in curve.pillars][0] == "CD91D"
    assert "1D" not in [label for label, _ in curve.pillars]


def test_on_rate_present_adds_1d_pillar_first():
    from dataclasses import replace

    snapshot = replace(_snapshot(), on_rate=0.0290)
    with managed_quantlib_env(to_ql_date(snapshot.valuation_date)):
        curve = build_curve(snapshot)
    labels = [label for label, _ in curve.pillars]
    assert labels[0] == "1D"
    assert labels[1] == "CD91D"


def test_delta_total_flips_sign_between_pay_and_receive_fixed():
    snapshot = _snapshot()
    pay_fixed = VanillaSwap(tenor_years=5, notional=10_000_000_000, fixed_rate=0.04, pay_fixed=True)
    receive_fixed = VanillaSwap(tenor_years=5, notional=10_000_000_000, fixed_rate=0.04, pay_fixed=False)

    pay_delta = delta(snapshot, pay_fixed).total_delta
    receive_delta = delta(snapshot, receive_fixed).total_delta

    assert pay_delta != 0
    assert receive_delta == pytest.approx(-pay_delta, rel=1e-9)
