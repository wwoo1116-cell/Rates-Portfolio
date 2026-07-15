"""
Single CD/IRS discount curve bootstrap using quant_engine.py. 
Consumes a `MarketSnapshot` (the data contract in core/market_data.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import numpy as np

from ..core.market_data import MarketSnapshot
from .quant_engine import bootstrap_zero_curve


@dataclass
class CurveBundle:
    valuation_date: date
    yield_curve: np.ndarray
    par_rates: list[tuple[float, float]]


def _quote_label(q) -> str:
    """'3M'/'6M'/'9M' under a year, '1Y'/'12Y' on whole-year boundaries."""
    if q.tenor_months is None:
        return f"{q.tenor_years}Y"
    months = q.tenor_months
    if months < 12:
        return f"{months}M"
    if months % 12 == 0:
        return f"{months // 12}Y"
    return f"{months / 12:g}Y"


def build_curve(snapshot: MarketSnapshot) -> CurveBundle:
    """Bootstraps the single discounting/projection curve from a MarketSnapshot."""
    par_rates = []
    
    # 1. O/N Rate (1D)
    if snapshot.on_rate is not None:
        par_rates.append((1.0 / 365.0, snapshot.on_rate))
        
    # 2. CD 91D Rate (3M)
    par_rates.append((91.0 / 365.0, snapshot.cd_rate))
    
    # 3. Swap Quotes
    def _months(q):
        return q.tenor_months if q.tenor_months is not None else q.tenor_years * 12
        
    for quote in sorted(snapshot.swap_quotes, key=_months):
        t_yr = _months(quote) / 12.0
        par_rates.append((t_yr, quote.rate))
        
    # 4. Bootstrap Zero Curve using quant_engine
    yield_curve = bootstrap_zero_curve(par_rates)
    
    return CurveBundle(
        valuation_date=snapshot.valuation_date,
        yield_curve=yield_curve,
        par_rates=par_rates
    )
