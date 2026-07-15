"""
Swap instrument definition -- parameters only; the IRS_Trade object is built on demand.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from .quant_engine import IRS_Trade, next_kr_business_day


@dataclass
class VanillaSwap:
    tenor_years: int
    notional: float
    fixed_rate: float
    pay_fixed: bool = True  # True = pay fixed / receive float
    float_spread: float = 0.0
    trade_date: date | None = None
    maturity_date: date | None = None  # if set, overrides tenor_years

    def to_irs_trade(self, valuation_date: date) -> IRS_Trade:
        """
        Converts this instrument definition into an executable IRS_Trade schedule
        for pricing. Replaces the old `to_ql_swap` method.
        """
        # Determine effective date (start date)
        if self.trade_date is not None:
            # SPOT_DAYS=1 logic: T+1 business day
            start_dt = next_kr_business_day(self.trade_date)
        else:
            # If no trade date is provided, assume standard spot from valuation
            start_dt = next_kr_business_day(valuation_date)

        # Determine maturity date
        if self.maturity_date is not None:
            mat_dt = self.maturity_date
        else:
            # Unadjusted raw termination date, IRS_Trade handles the modified following
            # internally via _modfol_bd
            mat_dt = start_dt + timedelta(days=round(self.tenor_years * 365))

        direction = -1 if self.pay_fixed else 1
        
        # quant_engine's IRS_Trade expects fixed_rate_pct.
        # Assuming fixed_rate is provided as a decimal (e.g. 0.03 for 3%).
        fixed_rate_pct = self.fixed_rate * 100.0

        return IRS_Trade(
            start_date=start_dt,
            maturity_date=mat_dt,
            fixed_rate_pct=fixed_rate_pct,
            direction=direction,
            notional=self.notional,
            sector="IRS",
            fixed_freq=0.25,
            float_freq=0.25
        )
