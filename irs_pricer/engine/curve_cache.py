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
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Sequence

import numpy as np

from . import curve as _curve_module
from . import quant_engine

logger = logging.getLogger(__name__)

# Distinct curves per snapshot measure ~16-20; the ceiling only binds when a
# user sweeps many valuation dates (backtests, the Status panel's 12-date
# trend). Each entry is a ~20x2 float64 array (~350B), so 2048 entries is
# well under a megabyte.
_MAX_ENTRIES = 2048

ParRates = Sequence[tuple[float, float]]

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
