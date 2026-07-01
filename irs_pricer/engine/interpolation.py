"""
Interpolation method strategies for the CD/IRS curve bootstrap (curve.py).

All three modes bootstrap from the *same* DepositRateHelper + SwapRateHelper
knot points -- only how QuantLib fills in the curve *between* those knots
differs:

- "flat": log-linear interpolation on discount factors. This is
  mathematically equivalent to holding the *forward rate* constant (flat)
  between knots -- the simplest convention, and the curve's original/default
  behavior. Kept unchanged for backward compatibility.
- "linear": linear interpolation on *zero (continuously-compounded spot)
  rates* between knots. Chosen over linear-on-discount-factor because
  zero-rate interpolation is the convention QuantLib's own Piecewise*Zero
  traits use, and it gives a directly comparable basis against "cubic"
  below (also zero-rate based) rather than mixing conventions.
- "cubic": monotonicity-preserving cubic (Kruger's method) interpolation on
  zero rates, same basis as "linear" above. A plain natural cubic spline
  can overshoot/oscillate between sparse points like swap tenor quotes
  (1Y, 2Y, 3Y, 5Y, 7Y, 10Y, ...) -- exactly the case Kruger's method is
  designed to avoid, so it's used here instead of QuantLib's default
  (non-monotonic) cubic spline.
"""

from __future__ import annotations

import QuantLib as ql

VALID_INTERPOLATION_METHODS = ("flat", "linear", "cubic")


def build_piecewise_curve(
    method: str,
    calc_date: ql.Date,
    helpers: list,
    day_count: ql.DayCounter,
) -> ql.YieldTermStructure:
    """Bootstrap a piecewise yield curve from `helpers` using the given interpolation method."""
    if method == "flat":
        return ql.PiecewiseLogLinearDiscount(calc_date, helpers, day_count)
    if method == "linear":
        return ql.PiecewiseLinearZero(calc_date, helpers, day_count)
    if method == "cubic":
        cubic_traits = ql.Cubic(ql.CubicInterpolation.Kruger, True)  # monotonic=True
        return ql.PiecewiseCubicZero(calc_date, helpers, day_count, [], [], cubic_traits)
    raise ValueError(f"Unknown interpolation_method {method!r}; expected one of {VALID_INTERPOLATION_METHODS}")
