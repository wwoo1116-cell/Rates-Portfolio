"""
Single CD/IRS discount curve bootstrap (QuantLib). Consumes a `MarketSnapshot`
(the data contract in core/market_data.py) and knows nothing about where the
quotes came from. Used for both discounting and floating-leg projection.
"""

from __future__ import annotations

from dataclasses import dataclass

import QuantLib as ql

from ..core.conventions import (
    BUSINESS_CONVENTION,
    CALENDAR,
    DAY_COUNT,
    FIXED_LEG_FREQUENCY,
    FLOAT_LEG_TENOR,
    SPOT_DAYS,
    to_ql_date,
)
from ..core.errors import CurveBootstrapError
from ..core.market_data import MarketSnapshot


@dataclass
class CurveBundle:
    valuation_date: ql.Date
    settlement_date: ql.Date
    yield_curve: ql.YieldTermStructure
    yield_curve_handle: ql.YieldTermStructureHandle
    float_index: ql.IborIndex
    # Ordered (label, pillar_maturity_date) for every bootstrap instrument --
    # "1D" (if on_rate is set) / "CD91D" / each swap quote's own label, each
    # date read back from its own RateHelper.maturityDate() (not recomputed
    # by hand) so it's guaranteed to match exactly what the bootstrap solved
    # for. Consumed by engine/risk.py to bump one pillar's discount factor at
    # a time without re-bootstrapping (see risk.py for why that distinction
    # matters).
    pillars: list[tuple[str, ql.Date]]


def _quote_label(q) -> str:
    """'3M'/'6M'/'9M' under a year, '1Y'/'12Y' on whole-year boundaries
    (whether that came from tenor_years alone or a whole-year tenor_months),
    '1.5Y'-style otherwise -- mirrors the CCP curve grid's own tenor labels
    (web/MarketDataSourcePanel.jsx's CCP_TENORS) instead of surfacing the raw
    month count for pillars like 12Y/15Y that only exist via tenor_months."""
    if q.tenor_months is None:
        return f"{q.tenor_years}Y"
    months = q.tenor_months
    if months < 12:
        return f"{months}M"
    if months % 12 == 0:
        return f"{months // 12}Y"
    return f"{months / 12:g}Y"


def build_curve(snapshot: MarketSnapshot) -> CurveBundle:
    """Bootstraps the single discounting/projection curve from a MarketSnapshot.

    KRX CCP convention: log-linear interpolation on discount factors between
    bootstrapped pillars -- ln(DF(t)) is linear in t between each (t1, t2)
    pair, i.e. ln_DF_t = ln(DF(t1)) + (t-t1)/(t2-t1) * (ln(DF(t2))-ln(DF(t1))),
    DF(t) = exp(ln_DF_t). This is applied consistently both during bootstrap
    (each helper's own pillar is solved against this same interpolation) and
    for any later discount-factor query at an arbitrary date. A direct
    consequence: the instantaneous forward rate is piecewise constant between
    pillars (forward(t1,t2) = -ln(DF(t2)/DF(t1))/(t2-t1) is, by construction,
    the same for every sub-interval within a single pillar-to-pillar span).
    (Implemented using PiecewiseLogLinearDiscount).
    """
    calc_date = to_ql_date(snapshot.valuation_date)
    settlement_date = CALENDAR.advance(calc_date, SPOT_DAYS, ql.Days)

    helpers = []
    pillars: list[tuple[str, ql.Date]] = []

    if snapshot.on_rate is not None:
        on_helper = ql.DepositRateHelper(
            ql.QuoteHandle(ql.SimpleQuote(snapshot.on_rate)),
            ql.Period(1, ql.Days),
            0,  # O/N (call rate) settles same-day, unlike CD91D's T+1 spot lag
            CALENDAR,
            BUSINESS_CONVENTION,
            False,
            DAY_COUNT,
        )
        helpers.append(on_helper)
        pillars.append(("1D", on_helper.maturityDate()))

    cd_helper = ql.DepositRateHelper(
        ql.QuoteHandle(ql.SimpleQuote(snapshot.cd_rate)),
        ql.Period(91, ql.Days),  # Exactly 91 days for KRX CD 91D convention
        SPOT_DAYS,
        CALENDAR,
        BUSINESS_CONVENTION,
        False,
        DAY_COUNT,
    )
    helpers.append(cd_helper)
    pillars.append(("CD91D", cd_helper.maturityDate()))

    yield_curve_handle = ql.RelinkableYieldTermStructureHandle()
    
    float_index = ql.IborIndex(
        "CD91D",
        FLOAT_LEG_TENOR,
        SPOT_DAYS,
        ql.KRWCurrency(),
        CALENDAR,
        BUSINESS_CONVENTION,
        False,
        DAY_COUNT,
        yield_curve_handle
    )

    def _months(q):
        return q.tenor_months if q.tenor_months is not None else q.tenor_years * 12

    for quote in sorted(snapshot.swap_quotes, key=_months):
        period = ql.Period(quote.tenor_months, ql.Months) if quote.tenor_months is not None else ql.Period(quote.tenor_years, ql.Years)
        swap_helper = ql.SwapRateHelper(
            ql.QuoteHandle(ql.SimpleQuote(quote.rate)),
            period,
            CALENDAR,
            FIXED_LEG_FREQUENCY,
            BUSINESS_CONVENTION,
            DAY_COUNT,
            float_index,
        )
        helpers.append(swap_helper)
        pillars.append((_quote_label(quote), swap_helper.maturityDate()))

    yield_curve = ql.PiecewiseLogLinearDiscount(calc_date, helpers, DAY_COUNT)
    yield_curve_handle.linkTo(yield_curve)

    # PiecewiseLogLinearDiscount is a QuantLib LazyObject: the actual pillar
    # solve doesn't run at construction, only on first query (discount/
    # zeroRate/...) -- wherever that first happens to be (a cashflow PV three
    # calls deep in mtm_valuation.py, for example). Forcing it here, in the
    # one place every caller passes through, means a bad/out-of-scale input
    # rate (bootstrap solver can't bracket a root) surfaces as a clean,
    # catchable CurveBootstrapError right at curve construction instead of an
    # opaque QuantLib RuntimeError wherever the lazy evaluation happened to
    # first trigger.
    try:
        yield_curve.discount(calc_date)
    except RuntimeError as e:
        raise CurveBootstrapError(e) from e

    fixing_date = CALENDAR.advance(calc_date, -SPOT_DAYS, ql.Days)
    # forceOverwrite=True: QuantLib stores index fixings in a global registry
    # keyed by index NAME ("CD91D"), not per-IborIndex-instance, so a second
    # build_curve() call at the same valuation_date but a different cd_rate
    # (bump-and-reprice delta scenarios; live market-data re-polls) would
    # otherwise raise "duplicated fixing" instead of simply superseding it.
    float_index.addFixing(fixing_date, snapshot.cd_rate, True)

    return CurveBundle(calc_date, settlement_date, yield_curve, yield_curve_handle, float_index, pillars)
