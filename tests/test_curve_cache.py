"""
Guards for engine/curve_cache.py -- the memoisation of the pure curve
bootstrap that quant_engine re-runs once per bumped node per swap.

The whole optimisation rests on bootstrap_zero_curve being a pure function of
par_rates. These tests pin that: identical inputs -> identical (indeed
bit-identical) risk numbers whether or not the cache is installed. If a future
change makes the bootstrap depend on anything beyond par_rates, the A/B test
here fails rather than the dashboard silently serving a stale curve.
"""

from __future__ import annotations

from datetime import date

import numpy as np
import pytest

from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine import curve_cache
from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.risk import bucketed_dv01

_VALUATION_DATE = date(2026, 6, 29)


def _dense_snapshot() -> MarketSnapshot:
    """Production-density curve -- one par quote at (almost) every KRD node, so
    each KRD label maps 1:1 to a distinct par node. Same rationale as
    test_engine_regression's fixture: a sparse curve collapses two labels onto
    one node and double-counts, which would muddy an A/B on the numbers."""
    quotes = [
        RateQuote(1, 0.0328, tenor_months=6),
        RateQuote(1, 0.0324, tenor_months=9),
        RateQuote(1, 0.0310),
        RateQuote(2, 0.0306, tenor_months=18),
        RateQuote(2, 0.0305),
        RateQuote(3, 0.0302),
        RateQuote(4, 0.0303),
        RateQuote(5, 0.0305),
        RateQuote(6, 0.0308),
        RateQuote(7, 0.0312),
        RateQuote(8, 0.0316),
        RateQuote(9, 0.0325),
        RateQuote(10, 0.0325),
    ]
    return MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=0.0330,
                          on_rate=0.0325, swap_quotes=quotes)


def _swap(mat_years: int = 5, fixed: float = 0.0305, pay_fixed: bool = True) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=mat_years,
        notional=1_000_000_000.0,
        fixed_rate=fixed,
        pay_fixed=pay_fixed,
        trade_date=date(2026, 6, 25),
        maturity_date=date(2026 + mat_years, 6, 25),
    )


@pytest.fixture
def uninstalled():
    """curve_cache is installed by the app's lifespan, not on import, so tests
    control it explicitly. Always restore -- it patches a module global, and
    leaking that into other tests would be invisible and confusing."""
    curve_cache.uninstall()
    curve_cache.clear()
    yield
    curve_cache.uninstall()
    curve_cache.clear()


def test_memoised_risk_is_bit_identical_to_unmemoised(uninstalled):
    """The load-bearing claim: the cache changes timing, never numbers."""
    snapshot = _dense_snapshot()
    swaps = [_swap(5), _swap(10, fixed=0.0325), _swap(3, pay_fixed=False)]

    expected = [bucketed_dv01(s, build_curve(snapshot)) for s in swaps]

    curve_cache.install()
    actual = [bucketed_dv01(s, build_curve(snapshot)) for s in swaps]

    assert len(actual) == len(expected)
    for got, want in zip(actual, expected):
        assert got.keys() == want.keys()
        for label in want:
            # Bit-identical, not approx: the cache returns the very array the
            # unmemoised path would have computed, so anything but equality
            # means it isn't the same curve.
            assert got[label] == want[label], f"KRD bucket {label} changed under memoisation"


def test_bootstrap_work_does_not_grow_with_book_size(uninstalled):
    """The invariant behind the speedup: the number of DISTINCT curves depends
    on the curve's own nodes, not on how many swaps are priced against it. So
    pricing more swaps must add hits, never misses -- that's what turns O(swaps
    x nodes) bootstraps into O(nodes).

    Asserted as "misses stop growing" rather than as a hit-rate threshold: hit
    rate is a function of book size (16 fixed misses amortise to 69% over 4
    swaps but 99.4% over the production book's 413), so a fixed threshold would
    just encode the size of the test fixture.
    """
    curve_cache.install()
    curve = build_curve(_dense_snapshot())

    for s in (_swap(5), _swap(7), _swap(10)):
        bucketed_dv01(s, curve)
    misses_after_first_pass = curve_cache.stats()["misses"]
    assert misses_after_first_pass > 0

    # A second, larger wave of swaps over the same curve: same schedules, more
    # of them, plus a repeat. Every bootstrap they need is already cached.
    for s in (_swap(5), _swap(5), _swap(7), _swap(10), _swap(5, pay_fixed=False)):
        bucketed_dv01(s, curve)

    stats = curve_cache.stats()
    assert stats["misses"] == misses_after_first_pass, (
        f"pricing more swaps against one curve re-bootstrapped: {stats}"
    )
    assert stats["hits"] > misses_after_first_pass


def test_install_is_idempotent(uninstalled):
    curve_cache.install()
    curve_cache.install()
    assert curve_cache.stats()["installed"] is True
    curve_cache.uninstall()
    assert curve_cache.stats()["installed"] is False


def test_cached_curve_is_not_mutable_by_callers(uninstalled):
    """Cached arrays are shared, not copied, so a caller mutating one would
    corrupt every later request. Nothing in the engine does (it only reads via
    np.interp) -- this pins that, and makes a future violation raise loudly
    instead of silently poisoning the cache."""
    curve_cache.install()
    curve = build_curve(_dense_snapshot()).yield_curve
    with pytest.raises(ValueError):
        curve[0, 0] = 999.0


def test_distinct_par_rates_do_not_collide(uninstalled):
    """A 1bp move must produce a different curve, not a cache hit."""
    curve_cache.install()
    base = _dense_snapshot()
    bumped = MarketSnapshot(
        valuation_date=base.valuation_date,
        cd_rate=base.cd_rate + 0.0001,
        on_rate=base.on_rate,
        swap_quotes=base.swap_quotes,
    )
    assert not np.array_equal(build_curve(base).yield_curve, build_curve(bumped).yield_curve)
