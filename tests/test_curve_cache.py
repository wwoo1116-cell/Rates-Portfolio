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


# ── iv4 perf pass: the /api/simulate path ────────────────────────────────────


def _fan_fixture_request():
    """The committed frozen-market fan fixture (1 bond + 1 swap, simDays 60) —
    market inputs live inside the request, so this is data-folder-independent
    and deterministic."""
    import copy
    import json
    from pathlib import Path

    p = Path(__file__).parent / "data" / "fan_non_monotone_request.json"
    return copy.deepcopy(json.loads(p.read_text(encoding="utf-8")))


def _run_simulate(payload) -> None:
    from irs_pricer.api.routers.simulate import SimulateRequest, simulate

    simulate(SimulateRequest(**payload))


def test_simulate_bootstrap_keys_are_swap_independent(uninstalled):
    """iv4 perf finding, pinned: a simulate run's bootstrap inputs are a
    function of (scenario, day) ONLY — measured 1,010 distinct keys for one
    swap and exactly 1,010 for eight distinct-maturity swaps. If this ever
    regresses to per-swap keys, no cache size can save the full book (658k
    single-use keys), so fail loudly here."""
    import copy

    curve_cache.install()

    base = _fan_fixture_request()
    _run_simulate(base)
    misses_one_swap = curve_cache.stats()["misses"]
    assert misses_one_swap > 0

    curve_cache.clear()
    many = _fan_fixture_request()
    swap = next(p for p in many["positions"] if str(p.get("bondType")).lower() == "swap")
    for i in range(7):
        c = copy.deepcopy(swap)
        c["id"] = f"{c['id']}-v{i}"
        c["name"] = f"{c['name']}-v{i}"
        c["maturityDate"] = f"{2028 + i}-{c['maturityDate'][5:]}"
        many["positions"].append(c)
    _run_simulate(many)
    stats = curve_cache.stats()

    assert stats["misses"] == misses_one_swap, (
        f"distinct bootstrap keys grew with swap count: {misses_one_swap} -> {stats['misses']} — "
        "the sim path's curves are no longer swap-independent"
    )
    assert stats["hits"] > stats["misses"], "the extra swaps should be pure cache hits"


def test_simulate_key_set_fits_cache_with_headroom(uninstalled):
    """The 24-minute full-book run was NOT missing memoisation — the run's
    ~2.5k distinct (scenario, day) curves marginally exceeded the old 2048-entry
    LRU, and the per-swap sweep over the day axis is the cyclic access pattern
    that collapses an over-capacity LRU to a ~0% hit rate (658,505 real
    bootstraps, 93% of wall — s18 profile). Pin BOTH sides: a run's key set is
    small, and the configured capacity dwarfs it."""
    curve_cache.install()
    _run_simulate(_fan_fixture_request())
    stats = curve_cache.stats()

    # A run's distinct-curve count stays in the low thousands…
    assert stats["misses"] < 4096, f"distinct curves per run exploded: {stats}"
    # …and capacity must hold ≥4x the key set of the worst MEASURED real run,
    # or the LRU cyclic-eviction pathology returns silently. s21 measured the
    # full live book (650 positions / 377 swaps, ramp+matrix, simDays 180,
    # 5 scenarios) at 11,661 distinct keys — 4.7x iv4's fixture extrapolation,
    # because real swaps' varied next-fixing dates mint short-anchor curve
    # variants the fixture's same-start-date clones collapsed to one
    # (docs/session-s21/fullbook-profile-ramp.txt). If a bigger book or a
    # longer horizon raises the measurement, raise _MAX_ENTRIES with it.
    _MEASURED_FULLBOOK_KEYS_S21 = 11_661
    assert curve_cache._MAX_ENTRIES >= 4 * _MEASURED_FULLBOOK_KEYS_S21, (
        f"_MAX_ENTRIES={curve_cache._MAX_ENTRIES}: under 4x the measured "
        f"real-book key set ({_MEASURED_FULLBOOK_KEYS_S21}) — back in the thrash zone "
        "(see the s21 note above the constant)"
    )

    # A repeat of the same run must be all hits — zero new bootstraps.
    misses_before = stats["misses"]
    _run_simulate(_fan_fixture_request())
    stats2 = curve_cache.stats()
    assert stats2["misses"] == misses_before, f"repeat run re-bootstrapped: {stats2}"


# ── s21 hardening: kill switch, key totality, raw-invocation contract ────────
#
# The owner-approved design ruling (s21): the module-global exact-key memo
# stays BECAUSE the key is total — the curve is a pure function of the par-rate
# vector and the full vector at exact float bit patterns is the key, so
# cross-run staleness is impossible by construction. These tests make that
# safety argument executable rather than prose. If any of them fails, the
# ruling's premise is broken: stop and report, don't resize or patch around it.

from irs_pricer.engine import quant_engine as _qe


def _fixture_payload(name: str) -> dict:
    import json
    from pathlib import Path

    return json.loads((Path(__file__).parent / "data" / name).read_text(encoding="utf-8"))


def test_env_kill_switch_controls_install(uninstalled, monkeypatch):
    """IRS_PRICER_CURVE_CACHE=0 must stop the lifespan from installing the
    wrapper (operational escape hatch + the A/B mechanism below); unset/other
    values must install as before. Read per startup, so each TestClient
    context sees the env the test just set."""
    from fastapi.testclient import TestClient

    from irs_pricer.api.app import app

    monkeypatch.setenv(curve_cache.ENV_FLAG, "0")
    with TestClient(app):
        assert curve_cache.stats()["installed"] is False, (
            "lifespan installed the cache despite the kill switch"
        )

    monkeypatch.delenv(curve_cache.ENV_FLAG)
    with TestClient(app):
        assert curve_cache.stats()["installed"] is True, (
            "default must be installed -- the switch is opt-OUT"
        )


def test_key_is_total_determinism_and_exact_roundtrip(uninstalled):
    """The two mechanical premises of key totality: (1) the raw bootstrap is
    deterministic -- same vector, bit-identical array -- so 'the first
    caller's result' and 'this caller's result' are the same thing; (2) the
    key round-trips the input exactly (the cached path computes from
    list(key), the float()-coerced reconstruction, NOT the caller's object --
    that reconstruction must be lossless for the float tuples the engine
    passes)."""
    par = [(0.25, 0.0251), (1.0, 0.0280), (2.0, 0.0300), (5.0, 0.0320), (10.0, 0.0325)]

    a = curve_cache._original(par)
    b = curve_cache._original(list(par))
    assert a.shape == b.shape and a.dtype == b.dtype
    assert a.tobytes() == b.tobytes(), "raw bootstrap is not deterministic"

    key = tuple((float(t), float(r)) for t, r in par)  # what _bootstrap_memoized builds
    assert list(key) == par, "key does not reconstruct the input exactly"

    curve_cache.install()
    c = _qe.bootstrap_zero_curve(par)
    assert c.shape == a.shape and c.dtype == a.dtype
    assert c.tobytes() == a.tobytes(), "cached result differs from the raw engine's"
    assert _qe.bootstrap_zero_curve(par) is c, "identical input should be a hit"


def test_key_totality_mutated_inputs_cannot_serve_stale_curves(uninstalled):
    """The property run-scoping was meant to buy, delivered by the key
    instead: a caller mutating its own par-rate structure mid-run gets a
    freshly computed, correct curve -- never the entry its pre-mutation call
    created. (The key is materialized per call, so 'the same list object'
    is irrelevant; only values matter.)"""
    curve_cache.install()

    par = [[1.0, 0.0300], [5.0, 0.0320]]  # deliberately mutable
    before = _qe.bootstrap_zero_curve(par).copy()

    par[1][1] = 0.0400  # snapshot "mutates mid-run"
    after = _qe.bootstrap_zero_curve(par)

    assert not np.array_equal(before, after), "mutated input served a stale curve"
    want = curve_cache._original([(1.0, 0.0300), (5.0, 0.0400)])
    assert after.tobytes() == want.tobytes(), "mutated input's curve is not the raw recompute"


def test_key_totality_run_determinants_reach_the_key(uninstalled):
    """Probe the determinants a partial key would be most likely to drop --
    sigma_bp (scales the percentile scenarios), baseDate (sets the
    tenor->year-fraction resolution of the fixture's tenor-labelled
    irsCurves), and the scenario shock vector itself. Each probe run differs
    from the previous ONLY in that determinant, so if it fails to mint new
    cache keys, two genuinely different curves are sharing entries and the
    module-global memo is unsafe: stand down, do not patch."""
    curve_cache.install()

    _run_simulate(_fan_fixture_request())
    m_base = curve_cache.stats()["misses"]
    assert m_base > 0

    probe = _fan_fixture_request()
    probe["sigma_bp"] = 4.0
    _run_simulate(probe)
    m_sigma = curve_cache.stats()["misses"]
    assert m_sigma > m_base, "sigma_bp does not reach the cache key"

    probe = _fan_fixture_request()
    probe["baseDate"] = "2026-07-22"
    _run_simulate(probe)
    m_date = curve_cache.stats()["misses"]
    assert m_date > m_sigma, "baseDate does not reach the cache key"

    probe = _fan_fixture_request()
    probe["shockCurves"]["swapCurve"] = [
        {**pt, "val": pt["val"] + 5.0} for pt in probe["shockCurves"]["swapCurve"]
    ]
    _run_simulate(probe)
    m_shock = curve_cache.stats()["misses"]
    assert m_shock > m_date, "the scenario shock vector does not reach the cache key"


def test_raw_engine_called_exactly_once_per_variant_and_never_on_repeat(uninstalled, monkeypatch):
    """The raw-invocation contract, pinned through the _original seam (the
    landed pins assert miss-counts, which lru_cache guarantees by
    construction; this counts what actually reaches the unmemoized engine, so
    a bypass path or a double-compute shows up here): a cold fixture run
    invokes the raw bootstrap exactly once per distinct par-rate variant --
    not one more -- and an identical second run invokes it exactly zero
    times."""
    calls = {"n": 0, "keys": set()}
    raw = curve_cache._original

    def counting(par_rates):
        calls["n"] += 1
        calls["keys"].add(tuple((float(t), float(r)) for t, r in par_rates))
        return raw(par_rates)

    monkeypatch.setattr(curve_cache, "_original", counting)
    curve_cache.install()

    _run_simulate(_fan_fixture_request())
    assert calls["n"] > 0
    assert calls["n"] == len(calls["keys"]), (
        f"raw engine ran {calls['n']} times for {len(calls['keys'])} distinct variants -- "
        "some variant was computed more than once"
    )
    assert calls["n"] == curve_cache.stats()["misses"], (
        "raw invocations != cache misses -- some path bypasses the memo"
    )

    n_cold = calls["n"]
    _run_simulate(_fan_fixture_request())
    assert calls["n"] == n_cold, (
        f"repeat run reached the raw engine {calls['n'] - n_cold} times; must be 0"
    )


@pytest.mark.parametrize(
    "fixture_name",
    ["fan_non_monotone_request.json", "simulate_request_representative.json"],
)
def test_simulate_http_bytes_identical_cached_vs_uncached(uninstalled, monkeypatch, fixture_name):
    """T2 A/B, permanent form: the same request POSTed through the real app
    with the cache killed vs installed must return byte-identical HTTP bodies
    -- fan bands, ratePaths, totalReturnDecomposition, exclusions, funding
    strip, everything, at the serialization level the frontend actually
    consumes. Zero tolerance; approx-equality here would defeat the point."""
    from fastapi.testclient import TestClient

    from irs_pricer.api.app import app

    payload = _fixture_payload(fixture_name)

    monkeypatch.setenv(curve_cache.ENV_FLAG, "0")
    with TestClient(app) as client:
        assert curve_cache.stats()["installed"] is False
        r_off = client.post("/api/simulate", json=payload)

    monkeypatch.delenv(curve_cache.ENV_FLAG)
    with TestClient(app) as client:
        assert curve_cache.stats()["installed"] is True
        r_on = client.post("/api/simulate", json=payload)

    assert r_off.status_code == 200 and r_on.status_code == 200
    assert r_off.content == r_on.content, (
        "cached and uncached responses differ at the byte level"
    )
