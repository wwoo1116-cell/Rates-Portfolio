"""s21 T2/T3 — fixture-set A/B: cached vs kill-switched /api/simulate.

For each committed fixture request this runs the full simulation three ways —
cache UNINSTALLED (the kill-switch path), cache installed COLD, and installed
WARM (identical repeat) — printing wall time, raw bootstrap_zero_curve
invocation counts (measured at the curve_cache._original seam, so the
uncached run is counted too), distinct-key counts, and the sha256 of the
canonically serialized response for each leg. Byte-identity of cached vs
uncached responses is asserted, not eyeballed.

Evidence script for docs/session-s21/ — measurement only, changes nothing.
Deliberately NOT named test_*.py (bare pytest trips on scripts/, the known
collection non-issue documented in REPORT_integration_v4).

Run from the repo root:  python scripts/s21_fixture_ab.py
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.engine import curve_cache  # noqa: E402
from irs_pricer.api.routers.simulate import SimulateRequest, simulate  # noqa: E402

DATA = Path(__file__).resolve().parents[1] / "tests" / "data"
FIXTURES = ["fan_non_monotone_request.json", "simulate_request_representative.json"]


def _canonical_sha(resp: dict) -> str:
    return hashlib.sha256(
        json.dumps(resp, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _counted_original():
    """Wrap the raw engine at the _original seam so BOTH paths are counted."""
    counter = {"calls": 0, "keys": set()}
    raw = curve_cache._original

    def counting(par_rates):
        counter["calls"] += 1
        counter["keys"].add(tuple((float(t), float(r)) for t, r in par_rates))
        return raw(par_rates)

    return counter, counting, raw


def _run(payload: dict) -> tuple[dict, float]:
    t0 = time.perf_counter()
    resp = simulate(SimulateRequest(**payload))
    return resp, time.perf_counter() - t0


def main() -> None:
    for name in FIXTURES:
        payload = json.loads((DATA / name).read_text(encoding="utf-8"))
        print(f"\n=== {name} (simDays={payload.get('simDays')}, "
              f"positions={len(payload.get('positions', []))}) ===")

        counter, counting, raw = _counted_original()
        curve_cache._original = counting
        try:
            # Leg 1: kill-switched (uninstalled) — every bootstrap is raw.
            curve_cache.uninstall()
            curve_cache.clear()
            # uninstall restores quant_engine's binding to curve_cache._original's
            # ORIGINAL value, bypassing the counting seam — rebind explicitly so
            # the uncached leg is counted as well.
            from irs_pricer.engine import quant_engine as qe
            from irs_pricer.engine import curve as curve_module
            qe.bootstrap_zero_curve = counting
            curve_module.bootstrap_zero_curve = counting

            resp_off, wall_off = _run(payload)
            calls_off = counter["calls"]
            print(f"cache OFF : wall {wall_off:8.2f}s  raw bootstraps {calls_off:>7} "
                  f"(distinct inputs {len(counter['keys'])})")

            # Leg 2: installed, cold.
            counter["calls"], counter["keys"] = 0, set()
            curve_cache.install()
            curve_cache.clear()
            resp_cold, wall_cold = _run(payload)
            stats_cold = curve_cache.stats()
            print(f"cache COLD: wall {wall_cold:8.2f}s  raw bootstraps {counter['calls']:>7} "
                  f"(== misses {stats_cold['misses']}, hits {stats_cold['hits']})")

            # Leg 3: installed, warm (identical repeat).
            calls_before = counter["calls"]
            resp_warm, wall_warm = _run(payload)
            print(f"cache WARM: wall {wall_warm:8.2f}s  raw bootstraps "
                  f"{counter['calls'] - calls_before:>7}")
        finally:
            curve_cache._original = raw
            curve_cache.uninstall()
            curve_cache.clear()

        sha_off, sha_cold, sha_warm = map(_canonical_sha, (resp_off, resp_cold, resp_warm))
        print(f"sha256 OFF  {sha_off}")
        print(f"sha256 COLD {sha_cold}")
        print(f"sha256 WARM {sha_warm}")
        assert sha_off == sha_cold == sha_warm, "A/B responses are NOT byte-identical"
        print("byte-identity: OK (OFF == COLD == WARM)")


if __name__ == "__main__":
    main()
