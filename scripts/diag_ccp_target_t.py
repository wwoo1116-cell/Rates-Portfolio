from datetime import date
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
import QuantLib as ql

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
    
    swap = VanillaSwap(
        tenor_years=1, notional=NOTIONAL, fixed_rate=0.03445, pay_fixed=False,
        trade_date=date(2026, 7, 1), maturity_date=date(2027, 7, 1),
    )
    
    res = value_booked_trade(swap, curve, fixings={date(2026, 7, 1): 0.0314, date(2026, 6, 30): 0.0314})
    
    target_npv = -31_184_543.38
    print(f"Engine NPV: {res.dirty_npv:,.2f}")
    print(f"Target NPV: {target_npv:,.2f}")
    print(f"Difference: {res.dirty_npv - target_npv:,.2f}")
