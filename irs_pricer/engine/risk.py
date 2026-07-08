"""
Sensitivity measures, built on top of engine.instruments.VanillaSwap.

Key-rate bucketed delta bumps the PAR MARKET QUOTE at one pillar (the O/N
deposit rate, the CD91D deposit rate, or one swap quote) by `bp` and fully
RE-BOOTSTRAPS the curve from that bumped MarketSnapshot (via build_curve()) --
not a direct discount-factor-space perturbation.

This module went through two direct-DF-space bump variants (flat ln(D) shift,
then a t-scaled zero-rate shift) before landing back here. Both were
mathematically clean (no cross-pillar leakage) but wrong for this book: for a
single-curve, no-spread swap, the floating leg's PV telescopes EXACTLY to
notional*(DF(next_reset_date) - DF(maturity_date)) -- a hard algebraic
identity, not an approximation (proved and verified numerically; see
PROGRESS.md). That means a direct-DF bump has ZERO effect on the floating leg
for any pillar that doesn't bracket the next reset date or the maturity date,
forcing near-zero/wrong-signed buckets at every OTHER intermediate pillar
(this book's 1Y/2Y) while dumping all of the floating leg's risk onto
whichever one or two pillars happen to bracket those two anchor dates
(CD91D here). The reference system's own ladder shows the opposite shape --
small, consistently-signed ("seesaw") deltas spread across every intermediate
tenor -- which a market-quote bump + full re-bootstrap reproduces naturally:
re-bootstrapping re-solves every pillar from the bumped one onward, so a
bump's effect on forward rates isn't confined to two telescoping anchor
points, it propagates smoothly across the whole remaining curve.

This DOES let a bump "leak" into later pillars' solved discount factors (a
later instrument's own calibration equation depends on the earlier, now-
bumped ones) -- that leakage is real and was the reason this approach was
replaced in an earlier session. It's being restored anyway: confirmed with
the user that the reference system does not use a dual-curve (separate
discounting/projection) framework, and empirically this single-curve
bump-and-rebootstrap convention -- leakage included -- is what actually
reproduces the reference ladder's shape, not the "cleaner" direct-DF
alternative.

There is deliberately no separate "parallel shift" scenario here: total_delta
is the sum of the individual bucket deltas (see services/pricing_service.py,
services/portfolio_service.py), not a separately re-priced parallel scenario.
"""

from __future__ import annotations

from dataclasses import replace

from ..core.market_data import MarketSnapshot
from .curve import CurveBundle, _quote_label, build_curve
from .instruments import VanillaSwap


def dv01(swap: VanillaSwap, curve: CurveBundle) -> float:
    """Fixed-leg PV change for a +1bp move in the swap's fixed rate."""
    return abs(swap.to_ql_swap(curve).fixedLegBPS())


_DEFAULT_BUMP = 1e-4  # 1bp


def _months(q):
    return q.tenor_months if q.tenor_months is not None else q.tenor_years * 12


def curve_bump_scenarios(snapshot: MarketSnapshot, bp: float = _DEFAULT_BUMP) -> list[tuple[str, CurveBundle]]:
    """One (pillar_label, bumped_curve) pair per curve pillar -- that
    pillar's own PAR MARKET QUOTE bumped by `bp` and the whole curve
    re-bootstrapped from scratch via build_curve() (see module docstring for
    why, despite the resulting cross-pillar leakage, this is the convention
    that matches the reference system). Ordered the same way build_curve()
    orders its pillars: O/N (if present), CD91D, then swap quotes by tenor.
    """
    scenarios: list[tuple[str, CurveBundle]] = []

    if snapshot.on_rate is not None:
        bumped_snapshot = replace(snapshot, on_rate=snapshot.on_rate + bp)
        scenarios.append(("1D", build_curve(bumped_snapshot)))

    bumped_snapshot = replace(snapshot, cd_rate=snapshot.cd_rate + bp)
    scenarios.append(("CD91D", build_curve(bumped_snapshot)))

    indexed_quotes = sorted(enumerate(snapshot.swap_quotes), key=lambda iq: _months(iq[1]))
    for index, quote in indexed_quotes:
        bumped_quotes = list(snapshot.swap_quotes)
        bumped_quotes[index] = replace(quote, rate=quote.rate + bp)
        bumped_snapshot = replace(snapshot, swap_quotes=bumped_quotes)
        scenarios.append((_quote_label(quote), build_curve(bumped_snapshot)))

    return scenarios
