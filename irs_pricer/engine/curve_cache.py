"""
Transparent memoization of quant_engine.bootstrap_zero_curve.

WHY THIS EXISTS
---------------
compute_irs_krd_map() re-bootstraps the zero curve once per bumped par-rate
node, per swap. The bootstrapped curve is a function of the par-rate vector
ALONE -- it does not depend on the swap being priced -- so pricing a book of
N swaps against one snapshot re-derives the same handful of curves N times
over. Measured on the production 686-position portfolio (413 IRS):

    bootstrap_zero_curve calls : 2855
    distinct par-rate inputs   :   16     -> 178x redundant
    build_pvbp_sensitivity     : 6.56s -> 0.46s once memoized (14.3x)

The per-swap short anchor (_inject_short_anchors, driven by each swap's next
float fixing) is what makes the inputs *look* swap-specific, but in practice
it collapses to a couple of distinct values across a whole book, so the hit
rate is ~99.4%.

WHY IT'S A WRAPPER AND NOT AN EDIT
----------------------------------
quant_engine.py is required to stay byte-identical to the authoritative copy
in rates-simulator-main/backend/quant_engine.py, so the cache cannot live
inside it. install() rebinds the module attribute instead; quant_engine's own
internal call sites resolve `bootstrap_zero_curve` through the module global
at call time, so they pick the wrapper up. engine/curve.py imported the name
directly (`from .quant_engine import bootstrap_zero_curve`), which binds at
import time, so that binding is rebound explicitly too.

SAFETY
------
bootstrap_zero_curve is pure: same par_rates -> same ndarray, no I/O, no
global state. Cached arrays are handed out shared rather than copied, so they
are marked read-only -- nothing in the engine mutates a bootstrapped curve
(it is only ever read through np.interp), and the flag turns any future
attempt into a loud ValueError instead of silent cross-request corruption.

Keys are the exact float bit patterns, never rounded: an unrounded key cannot
alias two genuinely different curves onto one entry, and identical inputs
recomputed the same way are bit-identical, so exactness costs no hit rate.
Verified bit-identical to the unmemoized engine over the production
portfolio (max abs diff 0.0) -- see tests/test_curve_cache.py.

KEY TOTALITY (why a module-global memo is safe at all)
------------------------------------------------------
bootstrap_zero_curve has exactly one input: the par-rate vector. The key IS
that vector, at full float precision -- so the key is TOTAL over the curve's
determinants, and every upstream quantity that shapes a curve (snapshot
quotes, the short anchors _inject_short_anchors derives from a swap's next
fixing, /api/simulate's baseDate -- which sets the tenor->year-fraction
resolution in resolve_curve_maturity_dates/parse_irs_curves -- the scenario
shock vector, sigma_bp's percentile scaling) reaches the bootstrap only BY
CHANGING THAT VECTOR. Two computations that could legitimately differ can
therefore never share an entry, which makes invalidation unnecessary and
cross-run staleness impossible by construction: TTLs, run-scoping, and
eviction-on-upload exist for caches whose keys are PARTIAL (the upload
router's clear() is belt-and-braces, not a correctness requirement).

Nor does correctness need the snapshot to be immutable during a run. The
simulate path builds its par vectors once per (scenario, day) as fresh local
lists from the Pydantic-parsed request (simulation_service.build_chart_data:
parse_irs_curves at the top, per-day shocked copies `[(t, r+shock), ...]`
below it) and never mutates one in place; but even a caller that DID mutate
its inputs mid-run would produce a different key and a freshly computed
curve, never a stale hit. Both halves are pinned executable in
tests/test_curve_cache.py (key-totality tests, s21).

One seam to keep honest: on a hit the caller gets the array computed from
`list(key)` -- the float()-coerced reconstruction of the first caller's
input, not the current caller's object. For the float tuples every engine
path passes, that reconstruction is exact (pinned); a caller passing exotic
numeric types falls through to the uncached original via the TypeError
guard in _bootstrap_memoized.

CONCURRENCY
-----------
Endpoints are sync `def`, so Starlette runs them on its threadpool: many
threads per worker process can hit this cache at once, and uvicorn
--workers 4 (the standard start since iv4) means 4 processes each holding an
independent copy (4 cold warmups, ~11MB apiece -- accepted cost). CPython's
functools.lru_cache is thread-safe for this use: its C implementation takes
an internal lock around bookkeeping, and the worst concurrent-miss race is
two threads bootstrapping the same key in parallel -- both produce
bit-identical arrays (the function is pure and deterministic), one insert
wins, no result is ever wrong. No extra locking is warranted.

KILL SWITCH
-----------
IRS_PRICER_CURVE_CACHE=0 stops the app lifespan from installing the wrapper
(default: installed). It is the A/B mechanism for the byte-identity evidence
and the operational escape hatch; the engine then runs unmemoized, correct
and slow.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Sequence

import numpy as np

from . import curve as _curve_module
from . import quant_engine

logger = logging.getLogger(__name__)

# Distinct curves per DASHBOARD snapshot measure ~16-20. A full /api/simulate
# run is the binding case (iv4 perf finding): its bootstrap inputs are
# swap-INDEPENDENT — measured 1,010 distinct keys for 1 swap and exactly
# 1,010 for 8 distinct-maturity swaps (1.00x growth). The sim's access order
# (per-swap sweeps over the whole day axis) is the pathological cyclic
# pattern for LRU: keys exceeding capacity by even a few percent collapse
# the hit rate to ~0, which is how s18 measured 658,505 real bootstraps
# (93% of a 24-minute full-book wall) on a server with this cache installed.
#
# s21 real-book measurement: iv4's ~2.5k-keys-per-run extrapolation from the
# fixture was LOW. A ramp/matrix 180-day 5-scenario run over the live book
# (650 positions, 377 swaps) produces 11,661 distinct keys — the fixture's
# swap clones shared one start date and therefore one short-anchor variant,
# while the real book's varied next-fixing dates mint ~13 curve variants per
# (scenario, day), not ~3. 32,768 gave only 2.8x headroom against that; the
# sizing policy is ≥4x the measured worst real run (the LRU cliff is silent
# and this is cheap insurance), so 65,536. ~350B/entry ≈ 22MB per worker,
# x4 workers ≈ 90MB — accepted. Capacity pin:
# tests/test_curve_cache.py::test_simulate_key_set_fits_cache_with_headroom.
_MAX_ENTRIES = 65536

ParRates = Sequence[tuple[float, float]]

# Read by the app lifespan (api/app.py): "0" means "do not install". Lives
# here so the switch is discoverable next to the thing it switches.
ENV_FLAG = "IRS_PRICER_CURVE_CACHE"

_original = quant_engine.bootstrap_zero_curve
_installed = False


@lru_cache(maxsize=_MAX_ENTRIES)
def _bootstrap_cached(key: tuple[tuple[float, float], ...]) -> np.ndarray:
    curve = _original(list(key))
    curve.flags.writeable = False
    return curve


def _bootstrap_memoized(par_rates: ParRates) -> np.ndarray:
    """Drop-in replacement for bootstrap_zero_curve.

    Falls back to the original on any input that can't be used as a cache key
    (a caller passing a numpy array or list-of-lists rather than the declared
    list of tuples) so memoization can never change behaviour -- worst case it
    stops helping.
    """
    try:
        key = tuple((float(t), float(r)) for t, r in par_rates)
    except (TypeError, ValueError):
        return _original(par_rates)
    return _bootstrap_cached(key)


def install() -> None:
    """Swap the memoized wrapper in. Idempotent; safe to call from app startup."""
    global _installed
    if _installed:
        return
    quant_engine.bootstrap_zero_curve = _bootstrap_memoized
    # curve.py bound the name at import time, so patching the module attribute
    # alone would leave its build_curve() call on the original.
    _curve_module.bootstrap_zero_curve = _bootstrap_memoized
    _installed = True
    logger.info("curve_cache installed (maxsize=%d)", _MAX_ENTRIES)


def uninstall() -> None:
    """Restore the unmemoized engine. Exists so tests can A/B the two paths."""
    global _installed
    quant_engine.bootstrap_zero_curve = _original
    _curve_module.bootstrap_zero_curve = _original
    _installed = False


def clear() -> None:
    _bootstrap_cached.cache_clear()


def stats() -> dict[str, int | float | bool]:
    """Cache counters, for the /health endpoint and for tests to assert on."""
    info = _bootstrap_cached.cache_info()
    total = info.hits + info.misses
    return {
        "installed": _installed,
        "hits": info.hits,
        "misses": info.misses,
        "entries": info.currsize,
        "hit_rate": round(info.hits / total, 4) if total else 0.0,
    }
