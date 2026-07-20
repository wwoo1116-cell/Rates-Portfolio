from datetime import date
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
import QuantLib as ql
from irs_pricer.core.conventions import CALENDAR, SPOT_DAYS

VALUATION_DATE = date(2026, 7, 3)
NOTIONAL = 30_000_000_000
CD_RATE = 0.0292
SWAP_QUOTES = [
    (1, 6, 0.031525), (1, 9, 0.033496), (1, 12, 0.035039), (2, 18, 0.036850), (2, 24, 0.037779),
    (3, 36, 0.037590), (4, 48, 0.037083), (5, 60, 0.036813), (10, 120, 0.036585)
]

def snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=VALUATION_DATE, cd_rate=CD_RATE, swap_quotes=[RateQuote(y, r, m) for y, m, r in SWAP_QUOTES],
    )

with managed_quantlib_env(to_ql_date(VALUATION_DATE)):
    curve = build_curve(snapshot())
    
    # 1. Modify value_booked_trade logic in-place for testing
    def test_value_booked_trade(swap, curve, fixings):
        from irs_pricer.engine.mtm_valuation import _build_periods, _price_fixed_leg, _price_floating_leg, _accrued_interest, from_ql_date
        
        valuation_date_ql = curve.valuation_date
        valuation_date = from_ql_date(valuation_date_ql)
        trade_date_ql = to_ql_date(swap.trade_date)
        maturity_date_ql = to_ql_date(swap.maturity_date)
        
        # FIX: Use T+1 as effective date
        effective_date_ql = CALENDAR.advance(trade_date_ql, SPOT_DAYS, ql.Days)
        
        periods = _build_periods(effective_date_ql, maturity_date_ql)
        remaining = [p for p in periods if p.payment_date > valuation_date]
        
        pv_fixed, fixed_details = _price_fixed_leg(remaining, curve, swap.notional, swap.fixed_rate)
        pv_floating, telescoping_used, telescoping_diverged, float_details = _price_floating_leg(
            remaining, curve, swap.notional, swap.float_spread, fixings
        )
        fixed_accrued, float_accrued = _accrued_interest(
            remaining, curve, valuation_date_ql, swap.notional, swap.fixed_rate, swap.float_spread, fixings
        )
        
        df_settlement = curve.yield_curve_handle.discount(curve.settlement_date)
        pv_fixed /= df_settlement
        pv_floating /= df_settlement
        for c in fixed_details:
            c.pv /= df_settlement
        for c in float_details:
            c.pv /= df_settlement
        
        if swap.pay_fixed:
            clean_npv = pv_floating - pv_fixed
            net_accrued = float_accrued - fixed_accrued
        else:
            clean_npv = pv_fixed - pv_floating
            net_accrued = fixed_accrued - float_accrued
        
        dirty_npv = clean_npv + net_accrued
        return dirty_npv
    
    swap = VanillaSwap(
        tenor_years=1, notional=NOTIONAL, fixed_rate=0.03445, pay_fixed=False,
        trade_date=date(2026, 7, 1), maturity_date=date(2027, 7, 1),
    )
    
    dirty_npv = test_value_booked_trade(swap, curve, fixings={date(2026, 7, 1): 0.0314, date(2026, 6, 30): 0.0314})
    target_npv = -31_184_543.38
    print(f"Engine NPV: {dirty_npv:,.2f}")
    print(f"Target NPV: {target_npv:,.2f}")
    print(f"Difference: {dirty_npv - target_npv:,.2f}")
