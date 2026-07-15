"""
Small in-process TTL cache for *derived* values.

Complements loaders/cache.py rather than duplicating it: that one keys parsed
workbook rows by (path, mtime) and is about not re-reading files. This one is
about not re-deriving values within a short window -- day-over-day shift
tables, CD fixing history, and the portfolio delta that all three Home
analytics panels ask for at the same instant.

No Redis/memcached in this deployment, and none is warranted: the cached
values are a few KB, derived from a single writer, and cheap to rebuild on a
miss. A module-global dict behind a lock is the whole requirement.

TTL semantics are deliberately blunt: an entry older than `ttl_seconds` is
recomputed on next access. There's no background refresh and no stale-while-
revalidate, so a cached value is never more than TTL old. Market data lands
once a day, so a 60s ceiling is far tighter than the data actually moves; the
TTL exists to bound staleness after an intraday re-upload, not to track a
live feed.

Thread-safe: FastAPI runs sync endpoints in a threadpool, so several requests
touch these entries concurrently. The lock guards the dict; the factory runs
OUTSIDE it, so a slow miss can't stall readers of other keys. Two threads
racing the same cold key may both compute -- that's a duplicated computation,
never a wrong answer, and it's cheaper than serialising every miss.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Callable, Hashable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

DEFAULT_TTL_SECONDS = 60.0

_store: dict[Hashable, tuple[float, Any]] = {}
_lock = threading.Lock()
_hits = 0
_misses = 0


def get_or_compute(
    key: Hashable,
    factory: Callable[[], T],
    ttl_seconds: float = DEFAULT_TTL_SECONDS,
) -> T:
    """Return the cached value for `key`, computing it via `factory` if absent
    or older than `ttl_seconds`."""
    global _hits, _misses
    now = time.monotonic()

    with _lock:
        entry = _store.get(key)
        if entry is not None and now - entry[0] < ttl_seconds:
            _hits += 1
            return entry[1]

    # Computed outside the lock on purpose -- see module docstring.
    value = factory()

    with _lock:
        _store[key] = (time.monotonic(), value)
        _misses += 1
    return value


def invalidate(key: Hashable) -> None:
    """Drop a single entry. Preferred over clear() on hot paths like the live
    RTD tick, which would otherwise wipe the whole cache several times a
    minute and leave it permanently cold."""
    with _lock:
        _store.pop(key, None)


def clear() -> None:
    """Drop every entry. Called when new market data is uploaded, and by tests."""
    global _hits, _misses
    with _lock:
        _store.clear()
        _hits = 0
        _misses = 0


def stats() -> dict[str, int | float]:
    with _lock:
        total = _hits + _misses
        return {
            "entries": len(_store),
            "hits": _hits,
            "misses": _misses,
            "hit_rate": round(_hits / total, 4) if total else 0.0,
        }
