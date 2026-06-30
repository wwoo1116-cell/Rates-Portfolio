"""Swap instrument definition -- parameters only; the QuantLib object is built on demand."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import QuantLib as ql

from .conventions import BUSINESS_CONVENTION, CALENDAR, DAY_COUNT, FLOAT_LEG_TENOR, to_ql_date
from .curve import CurveBundle


@dataclass
class VanillaSwap:
    tenor_years: int
    notional: float
    fixed_rate: float
    pay_fixed: bool = True  # True = pay fixed / receive float
    float_spread: float = 0.0
    trade_date: date | None = None
    maturity_date: date | None = None  # if set, overrides tenor_years for the leg schedule (MTM repricing)

    def to_ql_swap(self, curve: CurveBundle) -> ql.VanillaSwap:
        if self.maturity_date is not None:
            maturity_date = to_ql_date(self.maturity_date)
        else:
            # Unadjusted (raw) termination date -- ql.Schedule's own terminationDateConvention
            # (BUSINESS_CONVENTION, below) rolls it to a business day while generating the
            # backward date grid. Passing an already-adjusted date here instead anchors the
            # backward walk one day off the true period grid, which inserts a spurious extra
            # stub period -- exactly what SwapRateHelper's internal swap (curve.py bootstrap)
            # does NOT do, causing a small but nonzero NPV at the quoted par rate.
            maturity_date = CALENDAR.advance(
                curve.settlement_date,
                ql.Period(self.tenor_years, ql.Years),
                ql.Unadjusted,
                False,
            )
        schedule = ql.Schedule(
            curve.settlement_date,
            maturity_date,
            FLOAT_LEG_TENOR,
            CALENDAR,
            BUSINESS_CONVENTION,
            BUSINESS_CONVENTION,
            ql.DateGeneration.Backward,
            False,
        )
        swap = ql.VanillaSwap(
            ql.Swap.Payer if self.pay_fixed else ql.Swap.Receiver,
            self.notional,
            schedule,
            self.fixed_rate,
            DAY_COUNT,
            schedule,
            curve.float_index,
            self.float_spread,
            DAY_COUNT,
        )
        swap.setPricingEngine(ql.DiscountingSwapEngine(curve.yield_curve_handle))
        return swap
