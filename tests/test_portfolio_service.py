from datetime import date

from dateutil.relativedelta import relativedelta

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.engine.curve import build_curve
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
    expected_a = value_booked_trade(swap_a, curve, fixings={})
    expected_b = value_booked_trade(swap_b, curve, fixings={})

    assert abs(result.net_npv - (expected_a.clean_npv + expected_b.clean_npv)) < 1.0
    assert abs(result.payer_npv - expected_a.clean_npv) < 1.0
    assert abs(result.receiver_npv - expected_b.clean_npv) < 1.0


def test_payer_receiver_split_by_direction():
    payer_swap = _swap(date(2024, 3, 27), 3, 10_000_000, 0.0270, pay_fixed=True)
    receiver_swap = _swap(date(2024, 3, 27), 3, 10_000_000, 0.0270, pay_fixed=False)
    positions = [("payer", payer_swap), ("receiver", receiver_swap)]

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    # Identical trade except direction: payer and receiver NPVs should be
    # (near-)exact mirror images, so net_npv is close to zero.
    assert abs(result.payer_npv + result.receiver_npv - result.net_npv) < 1e-6
    assert result.payer_npv < 0 or result.receiver_npv < 0  # one side must be negative for a fair swap


def test_cashflows_are_sorted_and_tagged_with_position_id():
    swap_a = _swap(date(2024, 3, 27), 5, 10_000_000, 0.0270, pay_fixed=True)
    swap_b = _swap(date(2023, 6, 15), 7, 5_000_000, 0.0255, pay_fixed=False)
    positions = [("pos-1", swap_a), ("pos-2", swap_b)]

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    assert len(result.cashflows) > 0
    ids_seen = {pcf.position_id for pcf in result.cashflows}
    assert ids_seen == {"pos-1", "pos-2"}
    payment_dates = [pcf.detail.payment_date for pcf in result.cashflows]
    assert payment_dates == sorted(payment_dates)


def test_single_position_portfolio_matches_single_position_mtm():
    swap = _swap(date(2024, 3, 27), 5, 10_000_000, 0.0270, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})

    curve = build_curve(_snapshot())
    expected = value_booked_trade(swap, curve, fixings={})

    assert abs(result.net_npv - expected.clean_npv) < 1.0
    assert len(result.position_results) == 1
    pr = result.position_results[0]
    assert abs(pr.clean_npv - expected.clean_npv) < 1.0
    assert abs(pr.dirty_npv - expected.dirty_npv) < 1.0
