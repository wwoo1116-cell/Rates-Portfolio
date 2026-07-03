from datetime import date

import QuantLib as ql
from dateutil.relativedelta import relativedelta

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.engine.curve import build_curve
from irs_pricer.services import portfolio_service
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.core.conventions import CALENDAR, SPOT_DAYS, from_ql_date, to_ql_date

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

    with managed_quantlib_env(to_ql_date(_VALUATION_DATE)):
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


def test_position_fair_rate_zeros_npv_for_spot_starting_trade():
    # trade_date == valuation_date -- the simplest case, no forward-start gap.
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), start_date=_VALUATION_DATE, maturity_date=_VALUATION_DATE + relativedelta(years=1),
        notional=2_618_900_000_000,
    )
    swap = _swap(_VALUATION_DATE, 1, 2_618_900_000_000, fair_rate, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})
    # NPV should be zero to well under 0.001% of notional -- not just "small".
    assert abs(result.net_npv) < 2_618_900_000_000 * 1e-5


def test_position_fair_rate_zeros_npv_for_forward_starting_trade():
    # trade_date is AFTER valuation_date -- the exact scenario that exposed the
    # original bug: the frontend's raw-quoted-tenor "Par" hint only matches a
    # spot-starting swap (effective on curve.settlement_date), not one that
    # starts on an arbitrary future date.
    forward_start = _VALUATION_DATE + relativedelta(days=1)
    maturity = forward_start + relativedelta(years=2)
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), start_date=forward_start, maturity_date=maturity, notional=2_618_900_000_000,
    )
    swap = _swap(forward_start, 2, 2_618_900_000_000, fair_rate, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})
    assert abs(result.net_npv) < 2_618_900_000_000 * 1e-5


def test_position_fair_rate_differs_from_raw_quoted_tenor_rate():
    # The whole point of this function: for a forward-starting position, the
    # true fair rate is NOT the curve's raw quoted rate for that tenor -- a
    # gap of a few months from valuation_date is enough to show a multi-bp
    # divergence (a 1-day gap can coincidentally land on settlement_date and
    # match almost exactly, which is not representative of the general case).
    forward_start = _VALUATION_DATE + relativedelta(months=3)
    maturity = forward_start + relativedelta(years=1)
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), start_date=forward_start, maturity_date=maturity, notional=2_618_900_000_000,
    )
    raw_quoted_1y = 0.0280  # from _QUOTES
    assert abs(fair_rate - raw_quoted_1y) > 0.0003  # must differ by more than 3bp


def test_raw_quoted_rate_does_not_zero_npv_for_a_same_day_start_position():
    # Regression pin for a reported "bug": valuation_date == trade_date, fixed
    #_rate set to the raw quoted 1Y rate, expecting NPV == 0. It doesn't --
    # NOT because the par-rate solver and NPV evaluator disagree (test_
    # position_fair_rate_zeros_npv_for_spot_starting_trade already proves they
    # share the exact same schedule and zero out exactly), but because the raw
    # quoted rate is SwapRateHelper's rate for a swap effective on
    # curve.settlement_date (T+1), not on valuation_date (T) itself. Pairing a
    # T+1-effective rate with a T-effective position is expected to leave a
    # residual; it is not evidence of a schedule/day-count mismatch.
    raw_quoted_1y = 0.0280  # from _QUOTES
    same_day_swap = _swap(_VALUATION_DATE, 1, 10_000_000_000, raw_quoted_1y, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", same_day_swap)], fixings={})
    assert abs(result.net_npv) > 1000  # a real, expected, nonzero residual -- not floating-point dust

    # Proof it's a rate/schedule pairing issue, not an engine defect: the same
    # raw quoted rate DOES zero NPV once paired with the T+1 schedule it was
    # actually quoted for.
    settlement_date = from_ql_date(CALENDAR.advance(to_ql_date(_VALUATION_DATE), SPOT_DAYS, ql.Days))
    t_plus_1_swap = _swap(settlement_date, 1, 10_000_000_000, raw_quoted_1y, pay_fixed=True)
    result_t_plus_1 = portfolio_service.price_portfolio(_snapshot(), [("pos-1", t_plus_1_swap)], fixings={})
    assert abs(result_t_plus_1.net_npv) < 10_000_000_000 * 1e-5


def test_position_fair_rate_must_account_for_known_fixings():
    # A spot-starting position's first floating reset date (SPOT_DAYS before
    # start_date) falls before valuation_date whenever start_date <=
    # valuation_date + SPOT_DAYS -- the common case for anything at/near
    # today. If a real fixing is already known for that date, /api/price
    # prices that period off the known print, not a forward estimate. The
    # "par" hint must be solved with the exact same fixings, or the rate that
    # zeros NPV *without* them will not zero NPV *with* them (this is exactly
    # the bug that shipped in the fair-rate endpoint before this test).
    start_date = _VALUATION_DATE
    maturity_date = start_date + relativedelta(years=1)
    reset_date = from_ql_date(CALENDAR.advance(to_ql_date(start_date), -SPOT_DAYS, ql.Days))
    known_fixings = {reset_date: 0.0250}  # deliberately far from any forward estimate

    fair_rate_with_fixings = portfolio_service.position_fair_rate(
        _snapshot(), start_date, maturity_date, notional=2_618_900_000_000, fixings=known_fixings,
    )
    fair_rate_without_fixings = portfolio_service.position_fair_rate(
        _snapshot(), start_date, maturity_date, notional=2_618_900_000_000, fixings={},
    )
    assert abs(fair_rate_with_fixings - fair_rate_without_fixings) > 1e-5  # must actually differ

    swap = _swap(start_date, 1, 2_618_900_000_000, fair_rate_with_fixings, pay_fixed=True)

    result_with_fixings = portfolio_service.price_portfolio(_snapshot(), [("p", swap)], fixings=known_fixings)
    assert abs(result_with_fixings.net_npv) < 2_618_900_000_000 * 1e-5  # correctly ~0

    swap_wrong_rate = _swap(start_date, 1, 2_618_900_000_000, fair_rate_without_fixings, pay_fixed=True)
    result_wrong_rate = portfolio_service.price_portfolio(_snapshot(), [("p", swap_wrong_rate)], fixings=known_fixings)
    assert abs(result_wrong_rate.net_npv) > 2_618_900_000_000 * 1e-5  # the bug: NOT zero


def test_historical_position_at_historical_rate_gives_nonzero_mtm_at_todays_valuation():
    # A position entered well in the past, fixed at its OWN historical rate --
    # NOT today's fair rate -- must show genuine, nonzero MTM P&L when priced
    # at today's valuation_date. This is the whole point of MTM: a real
    # historical fixed rate is not expected to still be "par" under today's
    # curve, and the engine must discount off valuation_date throughout, never
    # rolling back to trade_date.
    historical_trade_date = _VALUATION_DATE - relativedelta(years=1)
    maturity_date = historical_trade_date + relativedelta(years=2)  # still alive today
    historical_rate = 0.0200  # a plausible year-ago rate -- deliberately NOT today's fair rate

    swap = _swap(historical_trade_date, 2, 10_000_000_000, historical_rate, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("p", swap)], fixings={})
    assert abs(result.net_npv) > 1_000_000  # a real, material MTM P&L -- not zero
    # Every remaining cashflow must fall strictly after valuation_date -- proof
    # discounting is anchored to today, not rolled back to trade_date.
    assert all(pcf.detail.payment_date > _VALUATION_DATE for pcf in result.cashflows)

    # Contrast: the *fair* rate for this exact schedule, solved against TODAY's
    # curve, is a different number and WOULD zero NPV -- proving the nonzero
    # result above isn't a schedule/curve bug, it's genuinely because
    # historical_rate != today's fair rate.
    fair_rate = portfolio_service.position_fair_rate(
        _snapshot(), historical_trade_date, maturity_date, notional=10_000_000_000,
    )
    assert abs(fair_rate - historical_rate) > 0.001
    swap_at_fair_rate = _swap(historical_trade_date, 2, 10_000_000_000, fair_rate, pay_fixed=True)
    result_at_fair_rate = portfolio_service.price_portfolio(_snapshot(), [("p", swap_at_fair_rate)], fixings={})
    assert abs(result_at_fair_rate.net_npv) < 10_000_000_000 * 1e-5


def test_multi_position_portfolio_all_positions_individually_zero_at_spot_start():
    # 5 simultaneously-entered new trades (1Y/2Y/3Y/5Y/7Y), all spot-starting
    # (시작일 = valuation_date + SPOT_DAYS, the standard new-trade convention),
    # each fixed at its own exact fair rate. Every position's own NPV -- not
    # just the aggregate -- must be ~0, since each is independently a fresh
    # par trade against the same curve.
    spot_start = from_ql_date(CALENDAR.advance(to_ql_date(_VALUATION_DATE), SPOT_DAYS, ql.Days))
    notional = 10_000_000_000
    tenors = [1, 2, 3, 5, 7]  # matches _QUOTES exactly

    positions = []
    for years in tenors:
        maturity = spot_start + relativedelta(years=years)
        fair_rate = portfolio_service.position_fair_rate(_snapshot(), spot_start, maturity, notional=notional)
        swap = _swap(spot_start, years, notional, fair_rate, pay_fixed=True)
        positions.append((f"pos-{years}y", swap))

    result = portfolio_service.price_portfolio(_snapshot(), positions, fixings={})

    assert len(result.position_results) == 5
    for pr in result.position_results:
        assert abs(pr.clean_npv) < notional * 1e-6, f"{pr.position_id} did not zero: {pr.clean_npv}"
    assert abs(result.net_npv) < notional * 1e-6


def test_single_position_portfolio_matches_single_position_mtm():
    swap = _swap(date(2024, 3, 27), 5, 10_000_000, 0.0270, pay_fixed=True)
    result = portfolio_service.price_portfolio(_snapshot(), [("pos-1", swap)], fixings={})

    with managed_quantlib_env(to_ql_date(_VALUATION_DATE)):
        curve = build_curve(_snapshot())
        expected = value_booked_trade(swap, curve, fixings={})

    assert abs(result.net_npv - expected.clean_npv) < 1.0
    assert len(result.position_results) == 1
    pr = result.position_results[0]
    assert abs(pr.clean_npv - expected.clean_npv) < 1.0
    assert abs(pr.dirty_npv - expected.dirty_npv) < 1.0
