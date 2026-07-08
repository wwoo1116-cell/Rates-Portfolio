"""
Architectural-integrity and financial-correctness suite for the QuantLib
pricing backend: valuation-date discipline, spot/forward-starting par-rate
consistency, historical MTM correctness, float-precision sensitivity, and
multi-position aggregation.

Uses a single synthetic (mock) MarketSnapshot fixture throughout -- no
dependency on the real market-data workbook, so this suite is fully
hermetic and deterministic.
"""
from __future__ import annotations

from datetime import date

import pytest
import QuantLib as ql
from dateutil.relativedelta import relativedelta

from irs_pricer.core.conventions import BUSINESS_CONVENTION, CALENDAR, SPOT_DAYS, from_ql_date, to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import portfolio_service

_QUOTES = [(1, 0.0280), (2, 0.0270), (3, 0.0265), (5, 0.0260), (7, 0.0258), (10, 0.0257)]


def _swap(
    trade_date: date,
    maturity_date: date,
    notional: float,
    fixed_rate: float,
    pay_fixed: bool = True,
    float_spread: float = 0.0,
) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=0,  # unused: maturity_date overrides it (see instruments.VanillaSwap docstring)
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        float_spread=float_spread,
        trade_date=trade_date,
        maturity_date=maturity_date,
    )


def _spot_date(valuation_date: date) -> date:
    """T+SPOT_DAYS business days -- the standard new-trade effective date."""
    return from_ql_date(CALENDAR.advance(to_ql_date(valuation_date), SPOT_DAYS, ql.Days))


def _business_days_forward(valuation_date: date, calendar_days: int) -> date:
    """valuation_date + N *calendar* days, rolled to a business day (Modified
    Following) -- used for the T+n forward-starting scenario."""
    return from_ql_date(
        CALENDAR.advance(to_ql_date(valuation_date), ql.Period(calendar_days, ql.Days), BUSINESS_CONVENTION)
    )


@pytest.fixture
def valuation_date() -> date:
    d = date(2026, 6, 29)
    assert CALENDAR.isBusinessDay(to_ql_date(d)), "fixture valuation_date must itself be a business day"
    return d


@pytest.fixture
def snapshot(valuation_date: date) -> MarketSnapshot:
    """Mock/synthetic curve snapshot -- deterministic, no external data file."""
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=0.0292,
        swap_quotes=[RateQuote(t, r) for t, r in _QUOTES],
    )


# ─────────────────────────────────────────────────────────────────────────
# 1) New trade, spot start (T+1)
# ─────────────────────────────────────────────────────────────────────────
def test_new_trade_spot_start_zeros_npv_exactly(valuation_date, snapshot):
    spot_date = _spot_date(valuation_date)
    maturity_date = spot_date + relativedelta(years=1)
    notional = 10_000_000_000

    fair_rate = portfolio_service.position_fair_rate(snapshot, spot_date, maturity_date, notional, fixings={})
    swap = _swap(spot_date, maturity_date, notional, fair_rate)
    result = portfolio_service.price_portfolio(snapshot, [("new-spot", swap)], fixings={})

    assert len(result.position_results) == 1
    assert abs(result.position_results[0].clean_npv) < 1e-3  # exact to float precision
    assert abs(result.net_npv) < 1e-3


# ─────────────────────────────────────────────────────────────────────────
# 2) Forward-starting trade (T+n)
# ─────────────────────────────────────────────────────────────────────────
def test_forward_starting_trade_zeros_npv_exactly(valuation_date, snapshot):
    start_date = _business_days_forward(valuation_date, 30)
    assert start_date > valuation_date
    maturity_date = start_date + relativedelta(years=2)
    notional = 5_000_000_000

    fair_rate = portfolio_service.position_fair_rate(snapshot, start_date, maturity_date, notional, fixings={})
    swap = _swap(start_date, maturity_date, notional, fair_rate)
    result = portfolio_service.price_portfolio(snapshot, [("forward-30d", swap)], fixings={})

    assert abs(result.net_npv) < 1e-3


# ─────────────────────────────────────────────────────────────────────────
# 3) Historical trade MTM -- valuation date must NOT roll back to trade_date
# ─────────────────────────────────────────────────────────────────────────
def test_historical_trade_mtm_uses_current_curve_not_trade_date(valuation_date, snapshot):
    start_date = from_ql_date(
        CALENDAR.adjust(to_ql_date(valuation_date - relativedelta(days=365)), BUSINESS_CONVENTION)
    )
    maturity_date = start_date + relativedelta(years=3)  # still alive as of valuation_date
    notional = 10_000_000_000
    historical_rate = 0.0250  # the rate this trade was actually booked at, a year ago

    # Curve reference date must be TODAY (valuation_date), never trade_date.
    with managed_quantlib_env(to_ql_date(valuation_date)):
        curve = build_curve(snapshot)
        assert curve.valuation_date == to_ql_date(valuation_date)
        assert curve.valuation_date != to_ql_date(start_date)

    swap = _swap(start_date, maturity_date, notional, historical_rate)
    result = portfolio_service.price_portfolio(snapshot, [("historical", swap)], fixings={})

    # A rate fixed a year ago essentially never coincides with today's fair
    # rate for the same remaining schedule -- the P&L must be real and material.
    assert abs(result.net_npv) > notional * 1e-4

    # Proof discounting stayed anchored to valuation_date: every remaining
    # cashflow's payment date must fall strictly after it (nothing from the
    # already-elapsed portion of the schedule should still be "remaining").
    assert all(pcf.detail.payment_date > valuation_date for pcf in result.cashflows)


# ─────────────────────────────────────────────────────────────────────────
# 4) Precision / truncation impact at high notional
# ─────────────────────────────────────────────────────────────────────────
def test_truncated_rate_leaks_material_residual_at_high_notional(valuation_date, snapshot):
    # A forward-starting (T+30d) schedule, not a spot-starting one: a
    # spot-starting whole-year fair rate can coincidentally land exactly on a
    # curve's quoted rate (already <=4 meaningful decimals), which would make
    # "truncation" a no-op and this test meaningless. Forward-starting forces
    # a genuinely interpolated, many-decimal fair rate.
    notional = 100_000_000_000  # 100bn KRW
    start_date = _business_days_forward(valuation_date, 30)
    maturity_date = start_date + relativedelta(years=5)

    exact_rate = portfolio_service.position_fair_rate(snapshot, start_date, maturity_date, notional, fixings={})
    truncated_rate = round(exact_rate * 100, 4) / 100  # 4-decimal-place UI display truncation
    assert exact_rate != truncated_rate  # sanity: truncation actually changed the value

    exact_result = portfolio_service.price_portfolio(
        snapshot, [("exact", _swap(start_date, maturity_date, notional, exact_rate))], fixings={},
    )
    assert abs(exact_result.net_npv) < 1e-3  # exact float -> ~0

    truncated_result = portfolio_service.price_portfolio(
        snapshot, [("truncated", _swap(start_date, maturity_date, notional, truncated_rate))], fixings={},
    )
    # Truncation must leak a residual that's both absolutely material and
    # orders of magnitude larger than the exact case's float-noise residual --
    # proving the backend genuinely consumes full precision rather than
    # silently rounding it away somewhere in the pipeline.
    assert abs(truncated_result.net_npv) > 1.0
    assert abs(truncated_result.net_npv) > abs(exact_result.net_npv) * 1000


# ─────────────────────────────────────────────────────────────────────────
# 5) Multi-position portfolio aggregation (new + historical mix)
# ─────────────────────────────────────────────────────────────────────────
def test_multi_position_portfolio_aggregates_new_and_historical_correctly(valuation_date, snapshot):
    notional_new = 10_000_000_000
    notional_hist = 5_000_000_000
    spot_date = _spot_date(valuation_date)

    new_positions = []
    for years in (1, 2, 3):
        maturity = spot_date + relativedelta(years=years)
        rate = portfolio_service.position_fair_rate(snapshot, spot_date, maturity, notional_new, fixings={})
        new_positions.append((f"new-{years}y", _swap(spot_date, maturity, notional_new, rate)))

    historical_start = from_ql_date(
        CALENDAR.adjust(to_ql_date(valuation_date - relativedelta(days=200)), BUSINESS_CONVENTION)
    )
    historical_maturity = historical_start + relativedelta(years=2)
    historical_positions = [
        ("historical-payer", _swap(historical_start, historical_maturity, notional_hist, 0.0240, pay_fixed=True)),
        ("historical-receiver", _swap(historical_start, historical_maturity, notional_hist, 0.0275, pay_fixed=False)),
    ]

    all_positions = new_positions + historical_positions
    result = portfolio_service.price_portfolio(snapshot, all_positions, fixings={})
    by_id = {pr.position_id: pr for pr in result.position_results}

    assert len(result.position_results) == len(all_positions)

    # New trades: each contributes ~0.00 individually.
    for position_id, _ in new_positions:
        assert abs(by_id[position_id].clean_npv) < 1e-3, f"{position_id} did not zero: {by_id[position_id].clean_npv}"

    # Historical trades: genuine, material MTM P&L.
    for position_id, _ in historical_positions:
        assert abs(by_id[position_id].clean_npv) > 100_000

    # Net NPV must be an exact sum of the individual clean_npv values -- no
    # separate/divergent aggregation path.
    assert result.net_npv == pytest.approx(sum(pr.clean_npv for pr in result.position_results), abs=1e-6)
    assert result.net_npv == pytest.approx(result.payer_npv + result.receiver_npv, abs=1e-9)


# ─────────────────────────────────────────────────────────────────────────
# 6) Portfolio-level delta: aggregation and offsetting positions
# ─────────────────────────────────────────────────────────────────────────
def test_offsetting_positions_net_to_near_zero_portfolio_delta(valuation_date, snapshot):
    """Same schedule, opposite direction -- every curve-pillar bucket (and the
    total) should cancel to ~0, the way an exactly matched book would."""
    spot_date = _spot_date(valuation_date)
    maturity_date = spot_date + relativedelta(years=5)
    notional = 10_000_000_000
    rate = portfolio_service.position_fair_rate(snapshot, spot_date, maturity_date, notional, fixings={})

    positions = [
        ("payer", _swap(spot_date, maturity_date, notional, rate, pay_fixed=True)),
        ("receiver", _swap(spot_date, maturity_date, notional, rate, pay_fixed=False)),
    ]
    result = portfolio_service.price_portfolio_delta(snapshot, positions, fixings={})

    assert abs(result.total_delta) < 1.0
    for bucket in result.buckets:
        assert abs(bucket.delta) < 1.0


def test_portfolio_buckets_equal_sum_of_position_buckets(valuation_date, snapshot):
    spot_date = _spot_date(valuation_date)
    notional = 10_000_000_000
    positions = []
    for years in (2, 5):
        maturity = spot_date + relativedelta(years=years)
        rate = portfolio_service.position_fair_rate(snapshot, spot_date, maturity, notional, fixings={})
        positions.append((f"pos-{years}y", _swap(spot_date, maturity, notional, rate)))

    result = portfolio_service.price_portfolio_delta(snapshot, positions, fixings={})

    by_pillar = {b.pillar: b.delta for b in result.buckets}
    expected_by_pillar = {}
    for pd in result.position_deltas:
        for b in pd.buckets:
            expected_by_pillar[b.pillar] = expected_by_pillar.get(b.pillar, 0.0) + b.delta

    assert by_pillar.keys() == expected_by_pillar.keys()
    for pillar, value in expected_by_pillar.items():
        assert by_pillar[pillar] == pytest.approx(value, abs=1e-6)

    assert result.total_delta == pytest.approx(
        sum(pd.total_delta for pd in result.position_deltas), abs=1e-6
    )


# ─────────────────────────────────────────────────────────────────────────
# QuantLib global Settings.evaluationDate isolation across independent calls
# ─────────────────────────────────────────────────────────────────────────
def test_quantlib_evaluation_date_isolated_across_independent_pricing_calls(snapshot):
    """managed_quantlib_env() must save/restore ql.Settings.instance().evaluationDate
    around every pricing call, and each call's own curve must be anchored to
    its own valuation_date -- with no leakage between back-to-back calls that
    use different, unrelated valuation dates."""
    baseline = ql.Settings.instance().evaluationDate

    date_a = date(2026, 6, 29)
    date_b = date(2025, 3, 10)
    assert CALENDAR.isBusinessDay(to_ql_date(date_a))
    assert CALENDAR.isBusinessDay(to_ql_date(date_b))
    assert date_a != date_b

    snapshot_a = MarketSnapshot(valuation_date=date_a, cd_rate=0.0292, swap_quotes=snapshot.swap_quotes)
    snapshot_b = MarketSnapshot(valuation_date=date_b, cd_rate=0.0250, swap_quotes=snapshot.swap_quotes)

    with managed_quantlib_env(to_ql_date(date_a)):
        curve_a = build_curve(snapshot_a)
        assert ql.Settings.instance().evaluationDate == to_ql_date(date_a)
        assert curve_a.valuation_date == to_ql_date(date_a)
    # Restored immediately after the context exits -- not left dangling at A.
    assert ql.Settings.instance().evaluationDate == baseline

    with managed_quantlib_env(to_ql_date(date_b)):
        curve_b = build_curve(snapshot_b)
        assert ql.Settings.instance().evaluationDate == to_ql_date(date_b)
        assert curve_b.valuation_date == to_ql_date(date_b)
        assert curve_b.valuation_date != to_ql_date(date_a)  # no leakage from the previous call
    assert ql.Settings.instance().evaluationDate == baseline

    # A third, completely independent service-level call afterward must see
    # only its OWN valuation date -- proof the two prior calls left no residue.
    spot_date = _spot_date(snapshot.valuation_date)
    maturity_date = spot_date + relativedelta(years=1)
    fair_rate = portfolio_service.position_fair_rate(
        snapshot, spot_date, maturity_date, 1_000_000_000, fixings={},
    )
    swap = _swap(spot_date, maturity_date, 1_000_000_000, fair_rate)
    result = portfolio_service.price_portfolio(snapshot, [("post-isolation-check", swap)], fixings={})
    assert abs(result.net_npv) < 1e-3
    assert ql.Settings.instance().evaluationDate == baseline
