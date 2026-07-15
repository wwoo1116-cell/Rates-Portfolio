"""Guards for core/ttl_cache.py."""

from __future__ import annotations

import threading

import pytest

from irs_pricer.core import ttl_cache


@pytest.fixture(autouse=True)
def _clear():
    ttl_cache.clear()
    yield
    ttl_cache.clear()


def test_second_call_within_ttl_does_not_recompute():
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return "value"

    assert ttl_cache.get_or_compute("k", factory) == "value"
    assert ttl_cache.get_or_compute("k", factory) == "value"
    assert calls["n"] == 1


def test_entry_recomputes_once_ttl_elapses():
    """Uses ttl_seconds=0 rather than sleeping: an entry can never be younger
    than a zero-second TTL, so every access is a miss."""
    calls = {"n": 0}

    def factory():
        calls["n"] += 1
        return calls["n"]

    assert ttl_cache.get_or_compute("k", factory, ttl_seconds=0) == 1
    assert ttl_cache.get_or_compute("k", factory, ttl_seconds=0) == 2
    assert calls["n"] == 2


def test_distinct_keys_are_independent():
    assert ttl_cache.get_or_compute("a", lambda: 1) == 1
    assert ttl_cache.get_or_compute("b", lambda: 2) == 2
    assert ttl_cache.get_or_compute("a", lambda: 99) == 1


def test_invalidate_drops_only_the_named_key():
    ttl_cache.get_or_compute("a", lambda: 1)
    ttl_cache.get_or_compute("b", lambda: 2)
    ttl_cache.invalidate("a")
    assert ttl_cache.get_or_compute("a", lambda: 10) == 10
    assert ttl_cache.get_or_compute("b", lambda: 20) == 2


def test_a_raising_factory_is_not_cached():
    """load_snapshot relies on this: a missing-data ValueError must not be
    remembered as if it were a value, or a date would stay broken for the
    whole TTL after the data lands."""
    calls = {"n": 0}

    def flaky():
        calls["n"] += 1
        if calls["n"] == 1:
            raise ValueError("no data yet")
        return "recovered"

    with pytest.raises(ValueError):
        ttl_cache.get_or_compute("k", flaky)
    assert ttl_cache.get_or_compute("k", flaky) == "recovered"


def test_concurrent_readers_get_a_consistent_value():
    """Sync FastAPI endpoints run in a threadpool, so these entries are touched
    from several threads at once. Racing a cold key may duplicate the compute;
    it must never hand back a wrong or partial value."""
    results: list[int] = []
    barrier = threading.Barrier(8)

    def worker():
        barrier.wait()
        results.append(ttl_cache.get_or_compute("shared", lambda: 42))

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results == [42] * 8
