"""
Single CD/IRS discount curve bootstrap (QuantLib). Consumes a `MarketSnapshot`
(the data contract in market_data.py) and knows nothing about where the
quotes came from. Used for both discounting and floating-leg projection.
"""

from __future__ import annotations

from dataclasses import dataclass

import QuantLib as ql

from .conventions import (
    BUSINESS_CONVENTION,
    CALENDAR,
    DAY_COUNT,
    FIXED_LEG_FREQUENCY,
    FLOAT_LEG_TENOR,
    SPOT_DAYS,
    to_ql_date,
)
from .interpolation import build_piecewise_curve
from .market_data import MarketSnapshot


@dataclass
class CurveBundle:
    valuation_date: ql.Date
    settlement_date: ql.Date
    yield_curve: ql.YieldTermStructure
    yield_curve_handle: ql.YieldTermStructureHandle
    float_index: ql.IborIndex


def build_curve(snapshot: MarketSnapshot, interpolation_method: str = "flat") -> CurveBundle:
    """Bootstraps the single discounting/projection curve from a MarketSnapshot.

    `interpolation_method` selects how the curve fills in between bootstrapped
    knot points ("flat" | "linear" | "cubic"; see interpolation.py). Defaults
    to "flat" so existing callers are unaffected.
    """
    calc_date = to_ql_date(snapshot.valuation_date)
    ql.Settings.instance().evaluationDate = calc_date
    settlement_date = CALENDAR.advance(calc_date, SPOT_DAYS, ql.Days)

    helpers = [
        ql.DepositRateHelper(
            ql.QuoteHandle(ql.SimpleQuote(snapshot.cd_rate)),
            FLOAT_LEG_TENOR,
            SPOT_DAYS,
            CALENDAR,
            BUSINESS_CONVENTION,
            False,
            DAY_COUNT,
        )
    ]

    float_index = ql.IborIndex(
        "CurveFloatIndex",
        FLOAT_LEG_TENOR,
        SPOT_DAYS,
        ql.KRWCurrency(),
        CALENDAR,
        BUSINESS_CONVENTION,
        False,
        DAY_COUNT,
    )

    for quote in sorted(snapshot.swap_quotes, key=lambda q: q.tenor_years):
        helpers.append(
            ql.SwapRateHelper(
                ql.QuoteHandle(ql.SimpleQuote(quote.rate)),
                ql.Period(quote.tenor_years, ql.Years),
                CALENDAR,
                FIXED_LEG_FREQUENCY,
                BUSINESS_CONVENTION,
                DAY_COUNT,
                float_index,
            )
        )

    yield_curve = build_piecewise_curve(interpolation_method, calc_date, helpers, DAY_COUNT)
    yield_curve_handle = ql.YieldTermStructureHandle(yield_curve)

    fixing_date = CALENDAR.advance(calc_date, -SPOT_DAYS, ql.Days)
    float_index.addFixing(fixing_date, snapshot.cd_rate)
    float_index = float_index.clone(yield_curve_handle)

    return CurveBundle(calc_date, settlement_date, yield_curve, yield_curve_handle, float_index)
