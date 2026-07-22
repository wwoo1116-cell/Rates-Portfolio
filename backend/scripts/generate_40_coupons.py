from __future__ import annotations
from datetime import date
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import _build_periods, value_booked_trade
import QuantLib as ql

VALUATION_DATE = date(2026, 7, 3)
START_DATE = date(2026, 7, 1)
MATURITY_DATE = date(2036, 7, 1)  # 10Y swap to get 40 coupons
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
        tenor_years=10, notional=NOTIONAL, fixed_rate=0.03445, pay_fixed=False,
        trade_date=START_DATE, maturity_date=MATURITY_DATE,
    )
    
    # We call value_booked_trade to run through the logic
    res = value_booked_trade(swap, curve, fixings={date(2026, 7, 1): 0.0314, date(2026, 6, 30): 0.0314})
    
    print("40-ROW COUPON TABLE (Fixed Leg Cashflows)")
    print(f"{'Row':<4} | {'Start':<12} | {'End':<12} | {'Pay Date':<12} | {'DCF':<12}")
    print("-" * 65)
    fixed_cfs = [c for c in res.cashflows if c.leg == "fixed"]
    for i, c in enumerate(fixed_cfs):
        # recalculate DCF to print
        dcf = ql.Actual365Fixed().yearFraction(to_ql_date(c.accrual_start), to_ql_date(c.accrual_end))
        print(f"{i:<4} | {str(c.accrual_start):<12} | {str(c.accrual_end):<12} | {str(c.payment_date):<12} | {dcf:.10f}")

