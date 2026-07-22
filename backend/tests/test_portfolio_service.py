"""Portfolio-service behaviour against the QuantLib-free engine.

Rewritten from the QuantLib-era harness: QuantLib parity checks and the
date-keyed `fixings=` MTM contract are gone. The non-QL `value_booked_trade`
takes a single scalar `current_float_rate` (None => forward-curve estimate),
and `price_portfolio(snapshot, positions, fixings)` reduces the fixings dict to
that scalar via the latest print (portfolio_service._extract_float_rate). The
service-level invariants below (aggregation, fair-rate zeroing, historical MTM,
per-position independence) hold regardless of engine.

NOTE: position_fair_rate() ignores fixings in the non-QL service (it solves the
par rate of a zero-fixed swap off the curve), so the QL-era
"fair rate must account for known fixings" regression no longer applies and has
been removed rather than asserted false.
"""

from datetime import date

import pytest
from dateutil.relativedelta import relativedelta

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.engine.quant_engine import next_kr_business_day
from irs_pricer.services import portfolio_service

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]
_VALUATION_DATE = date(2026, 6, 29)


def _snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=_VALUATION_DATE,
        cd_rate=0.0292,
        swap_quotes=[RateQuote(t, r) for t, r in _QUOTES],
    )


def _swap(trade_date: date, years: int, notional: float, fixed_rate: float, pay_fixed: bool) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=years,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        trade_date=trade_date,
        maturity_date=trade_date + relativedelta(years=years),
    )


def test_net_npv_equals_sum_of_position_clean_npv():
    swap_a = _swap(date(2024, 3, 27), 5, 10_000_000, 0.0270, pay_fixed=True)
    swap_b = _swap(date(2025, 1, 10), 7, 5_000_000, 0.0255, pay_fixed=False)
    positions = [("pos-1", swap_a), ("pos-2", swap_b)]

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    curve = build_curve(_snapshot())
    expected_a = value_booked_trade(swap_a, curve)
    expected_b = value_booked_trade(swap_b, curve)

    assert abs(result.net_npv - (expected_a.clean_npv + expected_b.clean_npv)) < 1.0
    assert abs(result.payer_npv - expected_a.clean_npv) < 1.0
    assert abs(result.receiver_npv - expected_b.clean_npv) < 1.0


def test_payer_receiver_split_by_direction():
    payer_swap = _swap(date(2024, 3, 27), 3, 10_000_000, 0.0270, pay_fixed=True)
    receiver_swap = _swap(date(2024, 3, 27), 3, 10_000_000, 0.0270, pay_fixed=False)
    positions = [("payer", payer_swap), ("receiver", receiver_swap)]

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    # Identical trade except direction: payer and receiver clean NPVs are exact
    # mirror images (direction flips the sign of the whole NPV), so net == 0.
    assert abs(result.payer_npv + result.receiver_npv - result.net_npv) < 1e-6
    assert abs(result.payer_npv + result.receiver_npv) < 1e-3


def test_cashflows_are_sorted_and_tagged_with_position_id():
    swap_a = _swap(date(2024, 3, 27), 5, 10_000_000, 0.0270, pay_fixed=True)
    swap_b = _swap(date(2023, 6, 15), 7, 5_000_000, 0.0255, pay_fixed=False)
    positions = [("pos-1", swap_a), ("pos-2", swap_b)]

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    assert len(result.cashflows) > 0
    assert {pcf.position_id for pcf in result.cashflows} == {"pos-1", "pos-2"}
    payment_dates = [pcf.detail.payment_date for pcf in result.cashflows]
    assert payment_dates == sorted(payment_dates)


def test_position_fair_rate_zeros_npv_for_spot_starting_trade():
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), start_date=_VALUATION_DATE,
        maturity_date=_VALUATION_DATE + relativedelta(years=1), notional=2_618_900_000_000,
    )
    swap = _swap(_VALUATION_DATE, 1, 2_618_900_000_000, fair_rate, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})
    assert abs(result.net_npv) < 2_618_900_000_000 * 1e-5


def test_position_fair_rate_zeros_npv_for_forward_starting_trade():
    forward_start = _VALUATION_DATE + relativedelta(days=1)
    maturity = forward_start + relativedelta(years=2)
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), start_date=forward_start, maturity_date=maturity, notional=2_618_900_000_000,
    )
    swap = _swap(forward_start, 2, 2_618_900_000_000, fair_rate, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})
    assert abs(result.net_npv) < 2_618_900_000_000 * 1e-5


def test_position_fair_rate_differs_from_raw_quoted_tenor_rate():
    # For a forward-starting position, the true fair rate is NOT the curve's
    # raw quoted rate for that tenor -- a 3-month start gap shows a multi-bp gap.
    forward_start = _VALUATION_DATE + relativedelta(months=3)
    maturity = forward_start + relativedelta(years=1)
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), start_date=forward_start, maturity_date=maturity, notional=2_618_900_000_000,
    )
    assert abs(fair_rate - 0.0280) > 0.0003  # raw quoted 1Y from _QUOTES, differs by >3bp


def test_historical_position_at_historical_rate_gives_nonzero_mtm():
    # A position entered a year ago at its own historical rate must show
    # genuine, material MTM at today's valuation, discounted off valuation_date.
    historical_trade_date = _VALUATION_DATE - relativedelta(years=1)
    swap = _swap(historical_trade_date, 2, 10_000_000_000, 0.0200, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("p", swap)], fixings={})
    assert abs(result.net_npv) > 1_000_000
    assert all(pcf.detail.payment_date > _VALUATION_DATE for pcf in result.cashflows)

    # The fair rate for the same schedule off TODAY's curve differs and WOULD
    # zero NPV -- proving the nonzero MTM is genuinely rate-driven, not a bug.
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), historical_trade_date, historical_trade_date + relativedelta(years=2),
        notional=10_000_000_000,
    )
    assert abs(fair_rate - 0.0200) > 0.001
    at_fair = _swap(historical_trade_date, 2, 10_000_000_000, fair_rate, pay_fixed=True)
    result_fair = portfolio_service.price_portfolio(_snapshot(), [("p", at_fair)], fixings={})
    # fair_rate zeros the DIRTY NPV; the CLEAN NPV (net_npv) still carries this
    # mid-period trade's genuine accrued interest, so check dirty_npv here.
    assert abs(result_fair.position_results[0].dirty_npv) < 10_000_000_000 * 1e-5


def test_multi_position_portfolio_all_positions_individually_zero_at_spot_start():
    # 5 spot-starting new trades, each struck at its own fair rate: every
    # position's own NPV (not just the aggregate) must be ~0.
    spot_start = next_kr_business_day(_VALUATION_DATE)
    notional = 10_000_000_000
    positions = []
    for years in (1, 2, 3, 5, 7):
        maturity = spot_start + relativedelta(years=years)
        fair_rate = portfolio_service.position_fair_rate(_snapshot(), spot_start, maturity, notional=notional)
        positions.append((f"pos-{years}y", _swap(spot_start, years, notional, fair_rate, pay_fixed=True)))

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    assert len(result.position_results) == 5
    for pr in result.position_results:
        assert abs(pr.clean_npv) < notional * 1e-5, f"{pr.position_id} did not zero: {pr.clean_npv}"
    assert abs(result.net_npv) < notional * 1e-5


def test_single_position_portfolio_matches_single_position_mtm():
    swap = _swap(date(2024, 3, 27), 5, 10_000_000, 0.0270, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})

    curve = build_curve(_snapshot())
    expected = value_booked_trade(swap, curve)

    assert abs(result.net_npv - expected.clean_npv) < 1.0
    assert len(result.position_results) == 1
    pr = result.position_results[0]
    assert abs(pr.clean_npv - expected.clean_npv) < 1.0
    assert abs(pr.dirty_npv - expected.dirty_npv) < 1.0


# ── portfolio-level delta aggregation (exercises engine.risk.bucketed_dv01) ──

def test_portfolio_delta_buckets_equal_sum_of_position_buckets():
    """The book's per-pillar delta must equal the pillar-wise sum of the
    individual positions' KRD, and total == sum of buckets."""
    positions = [
        ("a", _swap(date(2024, 3, 27), 5, 10_000_000_000, 0.0270, pay_fixed=True)),
        ("b", _swap(date(2025, 1, 10), 3, 5_000_000_000, 0.0255, pay_fixed=False)),
    ]
    result = portfolio_service.price_portfolio_delta(_snapshot(), positions, fixings={})

    agg: dict[str, float] = {}
    for pd in result.position_deltas:
        for b in pd.buckets:
            agg[b.pillar] = agg.get(b.pillar, 0.0) + b.delta
    book = {b.pillar: b.delta for b in result.buckets}
    assert book.keys() == agg.keys()
    for pillar, val in book.items():
        assert val == pytest.approx(agg[pillar], abs=1e-6)
    assert result.total_delta == pytest.approx(sum(b.delta for b in result.buckets), abs=1e-6)


def test_offsetting_positions_net_to_near_zero_portfolio_delta():
    """A payer and an identical receiver cancel: every book bucket ~0."""
    swap = _swap(date(2024, 3, 27), 5, 10_000_000_000, 0.0270, pay_fixed=True)
    opposite = _swap(date(2024, 3, 27), 5, 10_000_000_000, 0.0270, pay_fixed=False)
    result = portfolio_service.price_portfolio_delta(
        _snapshot(), [("long", swap), ("short", opposite)], fixings={})
    assert abs(result.total_delta) < 1e-3
    assert all(abs(b.delta) < 1e-3 for b in result.buckets)
