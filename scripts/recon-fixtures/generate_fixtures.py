"""RECON-SCEN fixture generator — real /api/simulate captures for the FE recon tests.

Runs the backend IN-PROCESS (FastAPI TestClient) against the sibling
krw-fi-pms-backend checkout — no live server, no port, no Data/ dependency:
every market input (irsCurves, fixing fields, fundingRate) is explicit in the
payload, which the backend honors verbatim ("이미 값이 채워져 온 포지션은
건드리지 않는다", services/simulation/swap_inputs.py).

Usage (from the FE repo root; backend path auto-resolved as ../krw-fi-pms-backend):
    python scripts/recon-fixtures/generate_fixtures.py

Regenerating REQUIRES a backend checkout at the pinned head (see
RECON_SCEN_REPORT.md T0) — fixture JSONs are committed so FE tests never need
the backend at runtime.

Three fixtures (design notes in src/features/simulation/lib/recon/README.md):
  linear.json     small +5bp parallel shock, near-linear waypoint path (midpoint
                  0.1bp OFF the exact line so the engine's SIM2-4 path-factor
                  activates and BOTH bond and swap lanes follow the same
                  calendar waypoint lerp the FE path machinery models —
                  chart.py's trivial-ramp regime would put swaps on a
                  biz-ranked ramp instead).
  shaped.json     non-monotone waypoint path + tenor/credit/irs spreads —
                  the deterministic engine-vs-linear gap the FE test pins.
  settlement.json zero-shock scenario over a window whose swap fixings are
                  already known (currentFloatRate supplied) — scenario ==
                  realized history for the fixed periods, so projected
                  settlements must equal the hand-computed realized ones.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

FE_ROOT = Path(__file__).resolve().parents[2]
BE_ROOT = FE_ROOT.parent / "krw-fi-pms-backend"
OUT_DIR = FE_ROOT / "src" / "features" / "simulation" / "lib" / "recon" / "__fixtures__"

sys.path.insert(0, str(BE_ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from irs_pricer.api.app import app  # noqa: E402

BASE_DATE = "2026-04-01"
# 45 days: catches TWO quarterly settlement dates of the two swaps below
# (2026-04-20 = day 19 and 2026-05-10→modfol 05-11 = day 40). The engine builds
# the ISDA schedule itself from startDate (quarterly grid) — nextFixingDate
# alone cannot place a payment inside the window.
SIM_DAYS = 45

# Flat-ish IRS par curve (decimals). t-only entries: resolve_curve_maturity_dates
# fills real maturity dates from base_date + t.
IRS_CURVES = [
    {"t": 0.25, "rate": 0.0260},
    {"t": 0.5, "rate": 0.0265},
    {"t": 1.0, "rate": 0.0270},
    {"t": 2.0, "rate": 0.0275},
    {"t": 3.0, "rate": 0.0280},
    {"t": 5.0, "rate": 0.0285},
    {"t": 10.0, "rate": 0.0290},
]


def bond(id_, sector, remaining_days, pvbp, tenor_label, mtm_yield):
    """Bond with krdMap populated (legacy-golden style) so the response's
    pvbpSensitivity carries real bond rows — the live bridge sends krdMap:{}
    and the FE grid then derives bond rows from request positions instead
    (both regimes are unit-tested)."""
    return {
        "id": id_,
        "name": id_,
        "book": "TEST",
        "bondType": "bond",
        "sector": sector,
        "couponRate": 2.5,
        "frequency": 2,
        "notional": 10_000_000_000,
        "entryYield": mtm_yield,
        "evaluationAmount": 10_000_000_000,
        "duration": remaining_days / 365.0 * 0.9,
        "pvbp": pvbp,
        "tenor": tenor_label,
        "remainingDays": remaining_days,
        "krdMap": {tenor_label: pvbp},
        "mtmYield": mtm_yield,
        "direction": 1,
    }


def swap(id_, direction, fixed_pct, float_pct, start, maturity, next_fixing, remaining_days):
    return {
        "id": id_,
        "name": id_,
        "book": "TEST",
        "bondType": "swap",
        "sector": "IRS",
        "maturityDate": maturity,
        "couponRate": fixed_pct,
        "frequency": 4,
        "notional": 10_000_000_000,
        "entryYield": 0,
        "evaluationAmount": 0,
        "duration": 0,
        "pvbp": 0,
        "tenor": "",
        "remainingDays": remaining_days,
        "krdMap": {},
        "direction": direction,
        "currentFloatRate": float_pct,
        "nextFixingDate": next_fixing,
        "startDate": start,
    }


# generateShockCurves transcription (scenario-curves.ts, byte-faithful) — the
# fixture payload must be exactly what buildSimulateRequest would ship.
def generate_shock_curves(base, s1, s10, s30, credit, irs_spread, short_end):
    short = short_end - base
    six_m = short + ((s1 - short) * (0.5 - 0.25)) / (1.0 - 0.25)
    nodes = [
        (1 / 365, short), (0.25, short), (0.5, six_m), (1, s1),
        (2, (s1 * (3 - 2)) / (3 - 1)), (3, 0),
        (5, (s10 * (5 - 3)) / (10 - 3)), (7, (s10 * (7 - 3)) / (10 - 3)),
        (10, s10), (20, s10 + (s30 - s10) * 0.5), (30, s30),
    ]
    ktb = [{"t": t, "val": base + s} for t, s in nodes]
    return {
        "bondCurves": {
            "국채": ktb,
            "특은채": [{"t": p["t"], "val": p["val"] + credit["특은채"]} for p in ktb],
            "은행채": [{"t": p["t"], "val": p["val"] + credit["은행채"]} for p in ktb],
            "카드채": [{"t": p["t"], "val": p["val"] + credit["카드채"]} for p in ktb],
            "회사채": [{"t": p["t"], "val": p["val"] + credit["회사채"]} for p in ktb],
        },
        "swapCurve": [{"t": p["t"], "val": p["val"] + irs_spread} for p in ktb],
    }


NO_CREDIT = {"특은채": 0, "은행채": 0, "카드채": 0, "회사채": 0}

BOOK = [
    bond("KTB-5Y", "국고채", 1825, 4_500_000, "5Y", 2.8),
    bond("CORP-3Y", "회사채", 1095, 2_700_000, "3Y", 3.4),
    # Quarterly grids anchored at startDate: IRS-PAY pays 10-20/01-20/04-20/…,
    # IRS-REC pays 11-10/02-10/05-10(→modfol 05-11)/…. Both carry the CURRENT
    # period's already-known fixing (scenario == realized history for that
    # period): the in-window settlement cash is fully determined at baseDate.
    swap("IRS-PAY", -1, 2.85, 2.60, "2025-07-20", "2028-07-20", "2026-04-20", 840),
    swap("IRS-REC", +1, 2.70, 2.55, "2025-08-10", "2028-08-10", "2026-05-10", 861),
]


def request_body(base_shock, waypoints, shock_curves):
    return {
        "positions": BOOK,
        "shockCurves": shock_curves,
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        "fundingRate": 0.0295,  # explicit (legacy semantics) — no funding-basis data dependency
        "fundingEvents": [],
        "simDays": SIM_DAYS,
        "shockType": "ramp",
        "shockMode": "matrix",
        "baseShockBp": base_shock,
        "baseDate": BASE_DATE,
        "irsCurves": IRS_CURVES,
        "customPath": waypoints,
        "sigma_bp": 2.0,
        "fundingStepping": False,
    }


def main() -> None:
    client = TestClient(app)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    fixtures = {
        # Midpoint 2.5bp vs exact-line 5×22/45≈2.444bp → non-trivial (engine
        # activation rule: any waypoint >1e-9 off target×day/simDays) →
        # calendar waypoint lerp on every lane. Effectively linear for the
        # residual's purposes.
        "linear": request_body(
            5.0,
            [{"day": 0, "bp": 0}, {"day": 22, "bp": 2.5}, {"day": 45, "bp": 5.0}],
            generate_shock_curves(5.0, 0, 0, 0, NO_CREDIT, 0, 5.0),
        ),
        "shaped": request_body(
            15.0,
            [
                {"day": 0, "bp": 0}, {"day": 11, "bp": 25}, {"day": 22, "bp": 10},
                {"day": 34, "bp": 32}, {"day": 45, "bp": 15},
            ],
            generate_shock_curves(15.0, -5, 8, 12, dict(NO_CREDIT, 회사채=4), 3, 15.0),
        ),
        "settlement": request_body(
            0.0,
            [],
            generate_shock_curves(0.0, 0, 0, 0, NO_CREDIT, 0, 0.0),
        ),
    }

    for name, req in fixtures.items():
        r = client.post("/api/simulate", json=req)
        r.raise_for_status()
        resp = r.json()
        out = OUT_DIR / f"{name}.json"
        out.write_text(
            json.dumps({"request": req, "response": resp}, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )
        recon = resp.get("irsDailyReconciliation") or []
        events = resp.get("irsSettlementEvents") or []
        daily = resp.get("decompositionDaily") or []
        print(f"[{name}] chartData={len(resp.get('chartData') or [])} rows, "
              f"recon={len(recon)}, events={len(events)}, decompDaily={len(daily)} -> {out.name}")
        if events:
            for ev in events:
                print(f"    settlement day={ev['day']} date={ev['date']} pos={ev['positionId']} cf={ev['settledCf']:,}")
        if daily:
            last = daily[-1]
            print(f"    final: bondMtm={last['bondMtm']:,.0f} swapMtm={last['swapMtm']:,.0f} total={last['total']:,.0f}")


if __name__ == "__main__":
    main()
