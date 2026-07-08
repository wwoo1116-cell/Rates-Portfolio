from __future__ import annotations
from datetime import date
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
import QuantLib as ql

VALUATION_DATE = date(2026, 7, 3)
START_DATE = date(2026, 7, 1)
MATURITY_DATE = date(2027, 7, 1)  # 1Y swap
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
    swap = VanillaSwap(
        tenor_years=1, notional=NOTIONAL, fixed_rate=0.03445, pay_fixed=False,
        trade_date=START_DATE, maturity_date=MATURITY_DATE,
    )
    
    res = value_booked_trade(swap, curve, fixings={date(2026, 7, 1): 0.03185, date(2026, 6, 30): 0.0314})
    
    print("FLOATING LEG CASHFLOWS (1Y SWAP)")
    print(f"{'Row':<4} | {'Start':<12} | {'End':<12} | {'Pay Date':<12} | {'Fwd Rate':<12} | {'Known?':<6} | {'Disc Factor':<12} | {'CF Amount':<15} | {'PV':<15}")
    print("-" * 115)
    
    float_cfs = [c for c in res.cashflows if c.leg == "floating"]
    df_settlement = curve.yield_curve_handle.discount(curve.settlement_date)
    
    for i, c in enumerate(float_cfs):
        df_payment = curve.yield_curve_handle.discount(to_ql_date(c.payment_date))
        df_to_settle = df_payment / df_settlement
        
        print(f"{i+1:<4} | {str(c.accrual_start):<12} | {str(c.accrual_end):<12} | {str(c.payment_date):<12} | {c.rate:.10f} | {str(c.is_known):<6} | {df_to_settle:.10f} | {c.cashflow:,.2f} | {c.pv:,.2f}")
    
    print("\nTotal Floating Leg PV: {:,.2f}".format(res.pv_floating_leg))
    print("Total Fixed Leg PV: {:,.2f}".format(res.pv_fixed_leg))
    print("Net NPV: {:,.2f}".format(res.dirty_npv))

