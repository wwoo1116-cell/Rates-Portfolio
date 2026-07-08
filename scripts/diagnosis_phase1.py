from __future__ import annotations
from datetime import date
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import _build_periods
from irs_pricer.services import portfolio_service
import QuantLib as ql

VALUATION_DATE = date(2026, 7, 3)
NOTIONAL = 30_000_000_000
CD_RATE = 0.0292
SWAP_QUOTES = [
    (1.5, 0.031525),
    (1.75, 0.033496),
    (1.0, 0.035039),
    (1.5, 0.036850),
    (2.0, 0.037779),
]

START_DATE = date(2026, 7, 1)
MATURITY_DATE = date(2036, 7, 1)  # 10Y swap to get 40 coupons

def snapshot() -> MarketSnapshot:
    return MarketSnapshot(
        valuation_date=VALUATION_DATE, cd_rate=CD_RATE, swap_quotes=[RateQuote(t, r) for t, r in SWAP_QUOTES],
    )

print('FIXED LEG COUPONS')
periods = _build_periods(to_ql_date(START_DATE), to_ql_date(MATURITY_DATE))
for i, p in enumerate(periods):
    print(f'Row {i}: {p.accrual_start} to {p.accrual_end} (Pay: {p.payment_date}) DCF: {ql.Actual365Fixed().yearFraction(p.accrual_start_ql, p.accrual_end_ql):.8f}')

with managed_quantlib_env(to_ql_date(VALUATION_DATE)):
    curve = build_curve(snapshot())
    swap = VanillaSwap(
        tenor_years=10, notional=NOTIONAL, fixed_rate=0.03445, pay_fixed=False,
        trade_date=START_DATE, maturity_date=MATURITY_DATE,
    ).to_ql_swap(curve)
    
    fixed_leg = swap.leg(0)
    print('\nQUANTLIB FIXED LEG COUPONS')
    for i, cf in enumerate(fixed_leg):
        coupon = ql.as_coupon(cf)
        if coupon:
            print(f'Row {i}: {coupon.accrualStartDate()} to {coupon.accrualEndDate()} (Pay: {coupon.date()}) DCF: {coupon.dayCounter().yearFraction(coupon.accrualStartDate(), coupon.accrualEndDate()):.8f}')

