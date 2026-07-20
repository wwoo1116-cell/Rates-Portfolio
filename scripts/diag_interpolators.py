from datetime import date
from irs_pricer.core.conventions import to_ql_date
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.context import managed_quantlib_env
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
import QuantLib as ql
import irs_pricer.engine.curve as curve_module

VALUATION_DATE = date(2026, 7, 3)
START_DATE = date(2026, 7, 1)
MATURITY_DATE = date(2027, 7, 1)
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
    swap = VanillaSwap(
        tenor_years=1, notional=NOTIONAL, fixed_rate=0.03445, pay_fixed=False,
        trade_date=START_DATE, maturity_date=MATURITY_DATE,
    )
    
    # Let's write a custom build_curve to override interpolator
    def build_curve_with_interpolator(snapshot, interp_class):
        helpers = [
            ql.DepositRateHelper(
                ql.QuoteHandle(ql.SimpleQuote(snapshot.cd_rate)),
                ql.Period(91, ql.Days),
                curve_module.SPOT_DAYS, curve_module.CALENDAR, curve_module.BUSINESS_CONVENTION,
                False, curve_module.DAY_COUNT,
            )
        ]
        yield_curve_handle = ql.RelinkableYieldTermStructureHandle()
        float_index = ql.IborIndex(
            "CD91D", curve_module.FLOAT_LEG_TENOR, curve_module.SPOT_DAYS, ql.KRWCurrency(),
            curve_module.CALENDAR, curve_module.BUSINESS_CONVENTION, False, curve_module.DAY_COUNT, yield_curve_handle
        )
        for quote in sorted(snapshot.swap_quotes, key=lambda q: q.tenor_months if q.tenor_months else q.tenor_years * 12):
            period = ql.Period(quote.tenor_months, ql.Months) if quote.tenor_months else ql.Period(quote.tenor_years, ql.Years)
            helpers.append(
                ql.SwapRateHelper(
                    ql.QuoteHandle(ql.SimpleQuote(quote.rate)), period, curve_module.CALENDAR,
                    curve_module.FIXED_LEG_FREQUENCY, curve_module.BUSINESS_CONVENTION, curve_module.DAY_COUNT, float_index,
                )
            )
        calc_date = curve_module.to_ql_date(snapshot.valuation_date)
        yield_curve = interp_class(calc_date, helpers, curve_module.DAY_COUNT)
        yield_curve_handle.linkTo(yield_curve)
        float_index.addFixing(curve_module.CALENDAR.advance(calc_date, -curve_module.SPOT_DAYS, ql.Days), snapshot.cd_rate)
        return curve_module.CurveBundle(calc_date, curve_module.CALENDAR.advance(calc_date, curve_module.SPOT_DAYS, ql.Days), yield_curve, yield_curve_handle, float_index)

    fixings = {date(2026, 7, 1): 0.03185, date(2026, 6, 30): 0.0314}
    
    curve_ll = build_curve_with_interpolator(snapshot(), ql.PiecewiseLogLinearDiscount)
    res_ll = value_booked_trade(swap, curve_ll, fixings)
    print(f"PiecewiseLogLinearDiscount NPV: {res_ll.dirty_npv:,.2f}")
    
    curve_lz = build_curve_with_interpolator(snapshot(), ql.PiecewiseLinearZero)
    res_lz = value_booked_trade(swap, curve_lz, fixings)
    print(f"PiecewiseLinearZero NPV: {res_lz.dirty_npv:,.2f}")
    
    curve_cz = build_curve_with_interpolator(snapshot(), ql.PiecewiseCubicZero)
    res_cz = value_booked_trade(swap, curve_cz, fixings)
    print(f"PiecewiseCubicZero NPV: {res_cz.dirty_npv:,.2f}")
    
    target = -31_184_543.38
    print(f"Target: {target:,.2f}")
    print(f"Diff LL: {res_ll.dirty_npv - target:,.2f}")
    print(f"Diff LZ: {res_lz.dirty_npv - target:,.2f}")
    print(f"Diff CZ: {res_cz.dirty_npv - target:,.2f}")
