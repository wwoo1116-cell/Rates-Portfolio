"""s21 T3 — full-book /api/simulate profile against the s18 baseline.

The s18 request payload was never committed, so this reconstructs the
full-book request in-process from the BE's own portfolio loader, mapping
parsed positions to the frozen FrontendPosition contract FIELD-FOR-FIELD the
way the live bridge does (UIUX_test src/app/(workspace)/simulation/
position-bridge.ts, s15/s18):

  bonds — full analytics from the blotter, krdMap sent EMPTY, direction +1,
  startDate = issue date;
  swaps — contract terms only (couponRate = fixed rate in %, direction
  +1 receive / −1 pay-fixed, remainingDays = calendar days from baseDate),
  every market field left for the backend to resolve; swaps at/past
  maturity on baseDate are dropped exactly as the bridge drops them;
  irsCurves [] — par quotes resolved from the backend's own snapshot store
  for baseDate, with honest exclusion if that date has no quotes.

If the loadable book differs from s18's 686 positions the actual composition
is printed — reported, not papered over (the 2026-07-16 14:11 data refresh
may well have changed the book).

Profiler: the s18 env-gated profiler, UNCHANGED — this script only sets
IRS_PRICER_SIM_PROFILE=1 and captures the [SIM PROFILE] lines it logs.

Evidence script for docs/session-s21/ — measurement only. NOT test_*.py on
purpose (bare-pytest collection non-issue).

Run from the repo root:
    python scripts/s21_fullbook_profile.py [simDays] [baseDate] [shock]
Defaults: simDays 180 (the s18 baseline's horizon), baseDate today-in-Seoul,
shock `step` (parallel step, the API defaults). `shock=ramp-matrix` instead
applies the fan fixture's exact shock configuration (30bp ramp, matrix mode,
its shockCurves and customPath verbatim) — the UI-shaped request whose
per-day-varying par vectors drive the per-swap day-axis sweep iv4 identified;
a step request's vectors repeat across days and exercise far fewer keys, so
BOTH shapes are measured rather than letting the friendlier one stand in for
the s18 baseline.
"""

from __future__ import annotations

import logging
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.setdefault("IRS_PRICER_SIM_PROFILE", "1")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logging.basicConfig(level=logging.INFO, format="%(message)s")

from irs_pricer.config import DATA_DIR  # noqa: E402
from irs_pricer.engine import curve_cache  # noqa: E402
from irs_pricer.loaders import portfolio as portfolio_loader  # noqa: E402
from irs_pricer.api.routers.simulate import SimulateRequest, simulate  # noqa: E402


def _iso(d) -> str | None:
    return d.isoformat() if d is not None else None


def bond_to_position(row: dict) -> dict:
    """Mirror of position-bridge.ts bondToSimPosition (loader amounts are
    already KRW, so no 억→원 scaling here)."""
    return {
        "id": row["position_id"],
        "name": row["position_id"],
        "book": row["book"],
        "bondType": "bond",
        "sector": row["sector"],
        "maturityDate": _iso(row.get("maturity_date")),
        "couponRate": row.get("coupon_rate") or 0.0,
        "frequency": row.get("payment_frequency") or 2,
        "notional": row["notional"],
        "entryYield": row.get("entry_yield") or 0.0,
        "mtmYield": row.get("mtm_yield"),
        "evaluationAmount": row.get("evaluation_amount") or 0.0,
        "duration": row.get("duration") or 0.0,
        "pvbp": row.get("pvbp") or 0.0,
        "tenor": row.get("tenor_bucket") or "",
        "remainingDays": row.get("remaining_days") or 0,
        "krdMap": {},
        "direction": 1,
        "startDate": _iso(row.get("issue_date")),
    }


def swap_to_position(row: dict, base_date: date) -> dict:
    """Mirror of position-bridge.ts swapToSimPosition — contract terms only."""
    return {
        "id": row["position_id"],
        "name": row["position_id"],
        "book": row["book"],
        "bondType": "swap",
        "sector": row["sector"] if row["sector"] in ("IRS", "OIS") else "IRS",
        "maturityDate": _iso(row["maturity_date"]),
        "couponRate": (row["fixed_rate"] or 0.0) * 100.0,  # loader decimal → contract %
        "frequency": 4,
        "notional": row["notional"],
        "entryYield": 0.0,
        "evaluationAmount": 0.0,
        "duration": 0.0,
        "pvbp": 0.0,
        "tenor": "",
        "remainingDays": max((row["maturity_date"] - base_date).days, 0),
        "krdMap": {},
        "direction": -1 if row["pay_fixed"] else 1,
        "currentFloatRate": 0.0,
        "startDate": _iso(row.get("start_date")),
    }


def main() -> None:
    sim_days = int(sys.argv[1]) if len(sys.argv) > 1 else 180
    date_args = [a for a in sys.argv[2:] if a not in ("step", "ramp-matrix", "s18-shape")]
    if date_args:
        base_date = date.fromisoformat(date_args[0])
    elif "s18-shape" in sys.argv[1:]:
        base_date = date(2026, 7, 15)  # s18's frozen-market run date
    else:
        base_date = datetime.now(ZoneInfo("Asia/Seoul")).date()
    if "s18-shape" in sys.argv[1:]:
        shock = "s18-shape"  # ramp-matrix + the fixture's frozen irsCurves
    elif "ramp-matrix" in sys.argv[1:]:
        shock = "ramp-matrix"
    else:
        shock = "step"

    rows = portfolio_loader.parse(DATA_DIR)
    bonds = [r for r in rows if r["instrument_type"] == "bond"]
    swaps = [
        r for r in rows
        if r["instrument_type"] == "irs" and r["maturity_date"] > base_date
    ]
    positions = [bond_to_position(r) for r in bonds] + [
        swap_to_position(r, base_date) for r in swaps
    ]

    print(f"[S21 FULLBOOK] DATA_DIR={DATA_DIR}")
    print(f"[S21 FULLBOOK] baseDate={base_date} simDays={sim_days}")
    print(f"[S21 FULLBOOK] book: {len(positions)} positions "
          f"({len(bonds)} bonds + {len(swaps)} live swaps; s18 baseline was 686/413)")

    payload = {
        "positions": positions,
        "shockCurves": {"bondCurves": {}, "swapCurve": []},
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        # No fundingRate — the live bridge's payload (기준금리+10bp constant).
        "fundingEvents": [],
        "simDays": sim_days,
        "shockType": "step",
        "shockMode": "parallel",
        "baseShockBp": 50.0,
        "baseDate": base_date.isoformat(),
        "irsCurves": [],   # resolved from the backend snapshot store (s15 T2)
        "customPath": [],
    }
    if shock in ("ramp-matrix", "s18-shape"):
        import json
        fan = json.loads(
            (Path(__file__).resolve().parents[1] / "tests" / "data"
             / "fan_non_monotone_request.json").read_text(encoding="utf-8")
        )
        payload["shockCurves"] = fan["shockCurves"]
        payload["customPath"] = fan["customPath"]
        payload["shockType"] = fan["shockType"]        # ramp
        payload["shockMode"] = fan["shockMode"]        # matrix
        payload["baseShockBp"] = fan["baseShockBp"]    # 30.0
        if shock == "s18-shape":
            # s18's run was "frozen-market fixture request" — par curve frozen
            # in the request, not resolved from the snapshot store.
            payload["irsCurves"] = fan["irsCurves"]
    print(f"[S21 FULLBOOK] shock config: {shock} "
          f"(shockType={payload['shockType']}, shockMode={payload['shockMode']}, "
          f"baseShockBp={payload['baseShockBp']}, customPath={len(payload['customPath'])} pts)")

    curve_cache.install()
    curve_cache.clear()

    t0 = time.perf_counter()
    resp = simulate(SimulateRequest(**payload))
    wall_cold = time.perf_counter() - t0
    stats = curve_cache.stats()

    print(f"[S21 FULLBOOK] COLD wall {wall_cold:.1f}s "
          f"(s18 pre-fix baseline: 1,409.7s / 658,505 raw bootstraps)")
    print(f"[S21 FULLBOOK] cache: misses(=distinct keys) {stats['misses']}, "
          f"hits {stats['hits']}, hit_rate {stats['hit_rate']}, "
          f"entries {stats['entries']}, capacity {curve_cache._MAX_ENTRIES} "
          f"(headroom {curve_cache._MAX_ENTRIES / max(stats['misses'], 1):.1f}x)")
    excl = resp.get("exclusions") or []
    print(f"[S21 FULLBOOK] exclusions: {len(excl)}")
    for e in excl[:5]:
        print(f"[S21 FULLBOOK]   {e}")

    t0 = time.perf_counter()
    simulate(SimulateRequest(**payload))
    wall_warm = time.perf_counter() - t0
    stats2 = curve_cache.stats()
    print(f"[S21 FULLBOOK] WARM wall {wall_warm:.1f}s "
          f"(new misses {stats2['misses'] - stats['misses']})")


if __name__ == "__main__":
    main()
