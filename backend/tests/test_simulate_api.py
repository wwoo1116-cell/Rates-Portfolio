"""
Integration tests for POST /api/simulate (the port of rates-simulator-main's
scenario simulator into irs_pricer).

Two layers of numerical evidence:

1. `test_matches_source_backend_golden` -- full-response parity against the
   REAL source implementation. tests/data/simulate_golden_source_response.json
   was captured on 2026-07-15 by running rates-simulator-main/backend/main.py
   (its own venv: numpy 2.4.6, scipy 1.17.1, holidays 0.100) on :8200 and
   POSTing tests/data/simulate_request_representative.json -- a request built
   exactly the way the frontend's buildSimulateRequest() builds one
   (scenario-curves.ts transcribed: generateShockCurves node-for-node), with
   3 bonds across the short/blend/long zones, a receive-fixed and a pay-fixed
   IRS with real schedule dates, one BOK cut, ramp+matrix mode, and a
   30-day-waypoint custom path over a 90-day horizon. At capture time the
   ported route reproduced the golden with ZERO diffs at rel_tol=1e-9
   (every rounded int exact, floats to the last bit).

2. `test_bond_only_analytic` -- hand-derived closed-form numbers for a
   single-bond parallel/step scenario, independent of any golden file:
   day-t bond MTM = pvbp * (remaining-t)/remaining * (-shock_bp), and daily
   carry = eval * ((mtmYield + shock/100) - funding*100)/100 / 365.

Contract note: the response shape is the frozen frontend contract
(UIUX_test src/features/simulation/api/simulate-dto.ts). Key names are
camelCase by design.
"""

from __future__ import annotations

import inspect
import json
import math
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from irs_pricer.api.app import app

DATA = Path(__file__).parent / "data"

REPRESENTATIVE_REQUEST = json.loads(
    (DATA / "simulate_request_representative.json").read_text(encoding="utf-8")
)
# [CHANGED, DV01-B] The golden is now the CURRENT backend's captured response
# (simulate_golden_dv01_response.json). Byte-parity with the SOURCE capture
# (simulate_golden_source_response.json, kept in-repo as the historical
# record) held until DV01-FIX Phase B intentionally departed on the bond MtM
# path: bond pvbp is re-derived server-side (services/bond_risk bump-reval)
# instead of trusting the wire's frozen-blotter figure. Representative-fixture
# delta at the departure: finalMTM −254,095,011 → −255,182,266 (+0.43% —
# the fixture's wire pvbp was internally consistent, so the re-derivation
# moves it only by the schedule/yield-base refinement; real stale blotters
# correct by ×0.678 aggregate, see DV01_FIX_REPORT.md); finalCarry/finalSwap
# byte-identical (swaps and carry never touch this data).
GOLDEN_RESPONSE = json.loads(
    (DATA / "simulate_golden_dv01_response.json").read_text(encoding="utf-8")
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(scope="module")
def representative_response(client: TestClient) -> dict:
    """One shared run of the representative request -- the endpoint is seconds
    of engine work (per-business-day KRD curve rebuilds), so shape and parity
    tests share a single response."""
    r = client.post("/api/simulate", json=REPRESENTATIVE_REQUEST)
    assert r.status_code == 200, r.text
    return r.json()


# ── 1. Contract shape ────────────────────────────────────────────────────────

def test_response_matches_frontend_contract_shape(representative_response: dict) -> None:
    body = representative_response

    # SimulateResponse keys (simulate-dto.ts) -- status is a source extra.
    # fundingCurve/distribution are the s11 additive extensions (T3/T4),
    # exclusions/totalReturnDecomposition the s15 ones (T2), and
    # decompositionDaily the HARDEN-1 one: the source contract may only ever
    # GROW by explicitly-listed keys, never change.
    assert set(body.keys()) == {
        "status", "chartData", "summary", "pvbpSensitivity",
        "bookDailyPnLs", "irsSettlementEvents", "irsDailyReconciliation",
        "fundingCurve", "distribution", "exclusions", "totalReturnDecomposition",
        "decompositionDaily", "fundingBasis",
    }
    assert body["status"] == "ok"

    # chartData: day 0 anchor + one row per Korean business day in the horizon.
    chart = body["chartData"]
    assert chart[0]["day"] == 0
    assert all(
        set(row) >= {"day", "mtmPnL", "cumulativeCarry", "swapPnL", "totalPnL",
                     "swapThetaPnL", "swapValuationPnL"}
        for row in chart
    )
    assert [row["day"] for row in chart] == sorted(row["day"] for row in chart)

    # SimulationSummary keys, exactly.
    assert set(body["summary"]) == {
        "finalMTM", "finalCarry", "finalSwap", "finalTotal", "breakEvenDay",
    }

    # pvbpSensitivity: all 9 sectors plus the 합계 row, each with tenors + total.
    sectors = [row["sector"] for row in body["pvbpSensitivity"]]
    assert sectors == ["국고채", "통안채", "특은채", "시은채", "공사채",
                       "여전채", "회사채", "IRS", "OIS", "합계"]
    for row in body["pvbpSensitivity"]:
        assert "합계" in row["tenors"]
        assert math.isclose(row["total"], row["tenors"]["합계"], rel_tol=1e-12)

    # bookDailyPnLs: one row per book plus Total, BookDailyPnL keys.
    books = [row["bookName"] for row in body["bookDailyPnLs"]]
    assert books == ["RP Fund", "Trading", "Total"]
    assert set(body["bookDailyPnLs"][0]) == {
        "bookName", "dailyCarry", "fundingCost", "bondValuation",
        "swapValuation", "swapThetaPnL", "totalDailyPnL",
    }


def test_include_distribution_gate_skips_scenario_expansion(
    client: TestClient, representative_response: dict
) -> None:
    """The percentile fan costs FOUR extra full-book engine runs (orchestrator's
    literal "scenario-expansion (4 runs)" phase re-runs build_chart_data over
    every position × every sim day), and the current UI does not render it --
    see components/panels/component-curves-panel.tsx, whose comment records that
    the fan was removed while the backend kept computing it. Measured on the live
    book (273 bonds + 413 swaps, simDays 180) that made one request take 6+ min.

    includeDistribution=False must skip those runs entirely: `distribution` comes
    back null -- already legal, SimulateResponse.distribution is nullable and the
    FE DTO types it optional -- while EVERY other field stays identical to the
    default run. Omitting the flag keeps the old behaviour (fan present), which is
    what keeps the golden-parity tests byte-identical."""
    r = client.post(
        "/api/simulate", json={**REPRESENTATIVE_REQUEST, "includeDistribution": False}
    )
    assert r.status_code == 200, r.text
    gated = r.json()

    assert representative_response["distribution"] is not None, (
        "default run must still carry the fan -- otherwise the gate's default flipped"
    )
    assert gated["distribution"] is None

    for key in representative_response:
        if key == "distribution":
            continue
        assert gated[key] == representative_response[key], (
            f"gating the distribution changed an unrelated field: {key}"
        )


def test_route_streams_and_offloads_the_engine() -> None:
    """simulate now STREAMS (Cloudflare tunnel ~100s 524 fix): the endpoint is
    an `async def` returning a StreamingResponse that flushes keepalive bytes
    while the run computes. Two properties still matter and are asserted here:

    1. It carries no declarative response_model (StreamingResponse can't be
       validated against one) — payload typing is instead preserved by
       serializing through SimulateResponse inside the handler, and the response
       *shape* is pinned by test_response_shape / the golden parity tests.
    2. The CPU-bound engine work must NOT run on the event loop. We can't prove
       run_in_executor structurally, but we guard the specific regression that
       would reintroduce blocking: the source module must reference
       `run_in_executor` (offload the run) rather than awaiting/calling
       run_simulation directly in the coroutine."""
    import inspect as _inspect

    from irs_pricer.api.routers import simulate as simulate_mod

    route = next(
        r for r in _walk(app.routes)
        if isinstance(r, APIRoute) and r.path == "/api/simulate"
    )
    assert route.response_model is None
    assert inspect.iscoroutinefunction(route.endpoint)
    assert "run_in_executor" in _inspect.getsource(simulate_mod.simulate), (
        "the engine run must be offloaded to a worker thread, never awaited "
        "directly in the streaming coroutine (that would block the event loop)."
    )


def _walk(routes):
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        inner = getattr(route, "original_router", None)
        if inner is not None:
            yield from _walk(inner.routes)


# ── 2. Golden parity vs the source implementation ────────────────────────────

def _assert_deep_close(mine, golden, path=""):
    if isinstance(golden, dict):
        assert isinstance(mine, dict) and set(mine) == set(golden), \
            f"{path}: keys {sorted(mine)} != {sorted(golden)}"
        for k in golden:
            _assert_deep_close(mine[k], golden[k], f"{path}.{k}")
    elif isinstance(golden, list):
        assert isinstance(mine, list) and len(mine) == len(golden), \
            f"{path}: len {len(mine)} != {len(golden)}"
        for i, (m, g) in enumerate(zip(mine, golden)):
            _assert_deep_close(m, g, f"{path}[{i}]")
    elif isinstance(golden, (int, float)) and not isinstance(golden, bool):
        # rel 1e-9 tolerates float serialisation noise while still requiring
        # every rounded-int field to agree exactly (their diffs are >= 1).
        assert math.isclose(mine, golden, rel_tol=1e-9, abs_tol=1e-6), \
            f"{path}: {mine} != {golden}"
    else:
        assert mine == golden, f"{path}: {mine!r} != {golden!r}"


def test_matches_source_backend_golden(representative_response: dict) -> None:
    # The golden file is the SOURCE backend's response. s11 extended the route
    # additively (fundingCurve/distribution), s15 again (exclusions/
    # totalReturnDecomposition), HARDEN-1 again (decompositionDaily) -- parity
    # is asserted over every key the source emitted, at full depth, and the
    # extras must be EXACTLY the known extensions (an unlisted key is a
    # contract change, not an extension, and must fail here).
    # [CHANGED, DV01-B] the golden is now a full current-contract capture, so
    # there are no extension keys beyond it. The historical additive-extension
    # provenance (fundingCurve → … → fundingBasis over the SOURCE golden) is
    # recorded at the GOLDEN_RESPONSE loader comment; an unlisted NEW key must
    # still fail here — the empty set stays the strictest possible pin.
    assert set(representative_response) - set(GOLDEN_RESPONSE) == set()
    _assert_deep_close(
        {k: representative_response[k] for k in GOLDEN_RESPONSE}, GOLDEN_RESPONSE
    )

    # Spot-pin the headline numbers so a stale/regenerated golden file can't
    # silently weaken this test. [CHANGED, DV01-B] from the 2026-07-15 source
    # capture's finalMTM −254,095,011 / finalTotal −191,006,631: the bond MtM
    # leg now rides bond_risk's reval DV01 (derivation in the module comment
    # above); carry and swap legs are byte-identical to the source.
    assert representative_response["summary"] == {
        "finalMTM": -255_182_266,
        "finalCarry": 36_920_495,
        "finalSwap": 26_167_885,
        "finalTotal": -192_093_885,
        "breakEvenDay": -1,
    }
    assert len(representative_response["chartData"]) == 61


# ── 3. Analytic bond-only case (no golden dependency) ────────────────────────

def test_bond_only_analytic(client: TestClient) -> None:
    """Single 1Y bond, parallel STEP shock of +10bp, 10 calendar days from
    Mon 2026-01-05 (8 KR business days: 1,2,3,4,7,8,9,10).

    Closed forms (source main.py calculate_daily_mtm/calculate_daily_carry):
      MTM(t)      = pvbp * (365-t)/365 * (-10)
      carry/cal-d = eval*(mtmYield+0.10)/100/365 - eval*funding/365
                  = 1e10 * 0.001/365          (mtmYield 3.0, funding 3.0%)
    accrued per CALENDAR day (each business day books dt_cal days of carry).
    """
    req = {
        "positions": [{
            "id": "b1", "name": "KTB", "book": "RP Fund", "bondType": "bond",
            "sector": "국고채", "couponRate": 3.0, "notional": 10_000_000_000,
            "evaluationAmount": 10_000_000_000, "mtmYield": 3.0,
            "duration": 1.0, "pvbp": 1_000_000, "tenor": "1Y",
            "remainingDays": 365, "krdMap": {"1Y": 1_000_000},
        }],
        "shockCurves": {"bondCurves": {}, "swapCurve": []},
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        "fundingRate": 0.03,
        "fundingEvents": [],
        "simDays": 10,
        "shockType": "step",
        "shockMode": "parallel",
        "baseShockBp": 10,
        "baseDate": "2026-01-05",
        # A flat par curve so the daily KRD reconciliation loop runs (the
        # empty-curve path is covered by test_bond_only_empty_irs_curves).
        "irsCurves": [{"t": 1.0, "rate": 0.03}, {"t": 5.0, "rate": 0.03}],
        "customPath": [],
    }
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()

    chart = body["chartData"]
    # Day 0 anchor + 8 business days.
    assert [row["day"] for row in chart] == [0, 1, 2, 3, 4, 7, 8, 9, 10]

    # Day 1: MTM = 1e6 * 364/365 * -10 = -9,972,602.74 ; carry = 27,397.26
    day1 = chart[1]
    assert day1["mtmPnL"] == round(1_000_000 * 364 / 365 * -10) == -9_972_603
    assert day1["cumulativeCarry"] == round(10_000_000_000 * 0.001 / 365) == 27_397
    assert day1["totalPnL"] == round(1_000_000 * 364 / 365 * -10 + 10_000_000_000 * 0.001 / 365) == -9_945_205
    assert day1["swapPnL"] == 0

    # Final day 10: MTM = 1e6 * 355/365 * -10. Carry accrues on CALENDAR days
    # (each business day carries dt_cal days, so Monday carries the weekend):
    # 10 calendar days' worth in total.
    final = chart[-1]
    assert final["mtmPnL"] == round(1_000_000 * 355 / 365 * -10) == -9_726_027
    assert final["cumulativeCarry"] == round(10 * 10_000_000_000 * 0.001 / 365) == 273_973
    assert body["summary"] == {
        "finalMTM": -9_726_027,
        "finalCarry": 273_973,
        "finalSwap": 0,
        "finalTotal": -9_452_055,
        "breakEvenDay": -1,
    }

    # bookDailyPnLs with a zero daily shock: carry and funding cancel exactly.
    assert body["bookDailyPnLs"] == [
        {"bookName": "RP Fund", "dailyCarry": 821_918, "fundingCost": -821_918,
         "bondValuation": 0, "swapValuation": 0, "swapThetaPnL": 0, "totalDailyPnL": 0},
        {"bookName": "Total", "dailyCarry": 821_918, "fundingCost": -821_918,
         "bondValuation": 0, "swapValuation": 0, "swapThetaPnL": 0, "totalDailyPnL": 0},
    ]

    # pvbpSensitivity aggregates the bond's krdMap into its sector row.
    ktb_row = next(r for r in body["pvbpSensitivity"] if r["sector"] == "국고채")
    assert ktb_row["tenors"]["1Y"] == 1_000_000
    assert ktb_row["total"] == 1_000_000
    grand = next(r for r in body["pvbpSensitivity"] if r["sector"] == "합계")
    assert grand["total"] == 1_000_000


# ── s11 T3: distribution fan bands ───────────────────────────────────────────

def test_distribution_bands(representative_response: dict) -> None:
    """Additive percentile fan: p50 must equal the base totalPnL trace exactly
    (the z=0 run IS the base run), bands aligned to chartData's day axis, and
    deterministic (no RNG).

    s15 T4: bands are keyed to their GENERATING rate-quantile scenario -- no
    per-day re-sorting -- so p5<=...<=p95 ordering is NOT asserted anymore
    (bands may cross on non-monotone books; on a rates-up-loses book the p95
    rate path sits below p50 by design). Scenario identity itself is pinned by
    test_fan_scenario_identity_non_monotone_book below."""
    dist = representative_response["distribution"]
    assert dist is not None
    assert dist["percentiles"] == [5, 25, 50, 75, 95]
    assert dist["sigmaBpDaily"] == 2.0
    assert dist["method"] == "quantile-scenario"

    chart = representative_response["chartData"]
    bands = dist["bands"]
    assert [b["day"] for b in bands] == [row["day"] for row in chart]
    for b, row in zip(bands, chart):
        assert b["p50"] == pytest.approx(row["totalPnL"]), (
            f"day {b['day']}: median band must be the base scenario trace"
        )
    # The fan must actually open: by the horizon the outer band pair straddles
    # a nonzero spread (a zero-width fan means the offset runs were dropped).
    assert bands[-1]["p95"] != bands[-1]["p5"]


def test_distribution_is_deterministic(client: TestClient, representative_response: dict) -> None:
    r2 = client.post("/api/simulate", json=REPRESENTATIVE_REQUEST)
    assert r2.status_code == 200
    assert r2.json()["distribution"] == representative_response["distribution"]


# ── s11 T4: funding-rate strip ───────────────────────────────────────────────

def test_funding_curve(representative_response: dict) -> None:
    """fundingCurve rides the same day axis as chartData and its rates obey the
    engine's own funding assumption: base fundingRate stepped by fundingEvents,
    carryBp == (positionRate - fundingRate) * 1e4."""
    fc = representative_response["fundingCurve"]
    chart = representative_response["chartData"]
    assert [p["day"] for p in fc] == [row["day"] for row in chart]

    req_rate = REPRESENTATIVE_REQUEST["fundingRate"]
    events = REPRESENTATIVE_REQUEST.get("fundingEvents") or \
        (REPRESENTATIVE_REQUEST.get("shockCurves") or {}).get("fundingEvents", [])
    base_date = REPRESENTATIVE_REQUEST["baseDate"][:10]

    for p in fc:
        expected = req_rate + sum(
            ev.get("shiftBp", 0) / 10000.0
            for ev in events
            if ev.get("date") and ev["date"] <= p["date"]
        )
        assert p["fundingRate"] == pytest.approx(expected), p
        if p["positionRate"] is not None:
            assert p["carryBp"] == pytest.approx(
                (p["positionRate"] - p["fundingRate"]) * 10000.0, abs=0.005
            ), p
    assert fc[0]["date"] == base_date
    # The representative book holds live bonds: the strip must be populated,
    # not a row of nulls.
    assert all(p["positionRate"] is not None for p in fc)


# ── s13 T2: configurable σ ───────────────────────────────────────────────────

def _bond_only_request(sigma_bp: float | None) -> dict:
    """The analytic single-bond fixture from test_bond_only_analytic: totalPnL
    is AFFINE in a parallel offset there (pvbp MTM + linear carry), so band
    half-widths must scale exactly with σ up to the engine's per-day rounding."""
    req = {
        "positions": [{
            "id": "b1", "name": "KTB", "book": "RP Fund", "bondType": "bond",
            "sector": "국고채", "couponRate": 3.0, "notional": 10_000_000_000,
            "evaluationAmount": 10_000_000_000, "mtmYield": 3.0,
            "duration": 1.0, "pvbp": 1_000_000, "tenor": "1Y",
            "remainingDays": 365, "krdMap": {"1Y": 1_000_000},
        }],
        "shockCurves": {"bondCurves": {}, "swapCurve": []},
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        "fundingRate": 0.03,
        "fundingEvents": [],
        "simDays": 10,
        "shockType": "step",
        "shockMode": "parallel",
        "baseShockBp": 10,
        "baseDate": "2026-01-05",
        "irsCurves": [],
        "customPath": [],
    }
    if sigma_bp is not None:
        req["sigma_bp"] = sigma_bp
    return req


def test_sigma_omitted_equals_two_exactly(client: TestClient) -> None:
    """Backward compat: no sigma_bp == sigma_bp=2.0, byte-identical response."""
    r_default = client.post("/api/simulate", json=_bond_only_request(None))
    r_two = client.post("/api/simulate", json=_bond_only_request(2.0))
    assert r_default.status_code == r_two.status_code == 200
    assert r_default.json() == r_two.json()
    assert r_default.json()["distribution"]["sigmaBpDaily"] == 2.0


@pytest.mark.parametrize("bad", [0, -1.5, 25.01, 100])
def test_sigma_out_of_bounds_is_422(client: TestClient, bad: float) -> None:
    r = client.post("/api/simulate", json=_bond_only_request(bad))
    assert r.status_code == 422, r.text
    assert "sigma_bp" in r.text


def test_sigma_scales_bands_and_never_moves_the_median(client: TestClient) -> None:
    """For ANY σ the median is the base scenario trace (z=0 run is the base
    run, σ-independent), and on the affine bond fixture the half-widths scale
    linearly in σ (tolerance = the engine's per-day int rounding)."""
    responses = {s: client.post("/api/simulate", json=_bond_only_request(s)).json()
                 for s in (1.0, 2.0, 4.0)}

    base_trace = [row["totalPnL"] for row in responses[2.0]["chartData"]]
    for s, body in responses.items():
        assert body["distribution"]["sigmaBpDaily"] == s
        assert [row["totalPnL"] for row in body["chartData"]] == base_trace
        assert [b["p50"] for b in body["distribution"]["bands"]] == pytest.approx(base_trace)

    def half_widths(body: dict) -> list[tuple[float, float]]:
        # s15 T4: bands are scenario-keyed (p95 = the +1.645sigma RATE path), so
        # on this LONG bond fixture p95 sits BELOW p50 -- the "half-widths" are
        # signed offsets from the median and scale linearly in sigma either way.
        return [(b["p95"] - b["p50"], b["p50"] - b["p5"]) for b in body["distribution"]["bands"][1:]]

    for hw1, hw2, hw4 in zip(half_widths(responses[1.0]), half_widths(responses[2.0]),
                             half_widths(responses[4.0])):
        for k in (0, 1):
            assert hw2[k] == pytest.approx(2.0 * hw1[k], abs=3.0), (hw1, hw2)
            assert hw4[k] == pytest.approx(2.0 * hw2[k], abs=3.0), (hw2, hw4)
    # and the fan actually opens
    assert abs(half_widths(responses[2.0])[-1][0]) > 0


# ── 4. The live bridge's request shape (empty irsCurves) ─────────────────────

def test_bond_only_empty_irs_curves(client: TestClient) -> None:
    """The S6 position bridge (UIUX_test position-bridge.ts) does not carry IRS
    par rates yet: every real click on 시뮬레이션 실행 posts irsCurves: [] with
    bond-only positions. The SOURCE implementation 500s on that (its daily-KRD
    reconciliation loop bootstraps the par curve unconditionally -- ValueError
    on the empty list, measured 2026-07-15). This port's ONE deliberate runtime
    divergence: with an empty par curve the IRS reconciliation table is simply
    empty, and every bond-side output is still produced."""
    req = {
        "positions": [{
            "id": "b1", "name": "KTB", "book": "RP Fund", "bondType": "bond",
            "sector": "국고채", "couponRate": 3.0, "notional": 10_000_000_000,
            "evaluationAmount": 10_000_000_000, "mtmYield": 3.0,
            "duration": 1.0, "pvbp": 1_000_000, "tenor": "1Y",
            "remainingDays": 365, "krdMap": {},
        }],
        "shockCurves": {"bondCurves": {"국채": [{"t": 1, "val": 10}]}, "swapCurve": [{"t": 1, "val": 13}]},
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        "fundingRate": 0.042,
        "fundingEvents": [],
        "simDays": 10,
        "shockType": "ramp",
        "shockMode": "matrix",
        "baseShockBp": 10,
        "baseDate": "2026-01-05",
        "irsCurves": [],
        "customPath": [{"day": 0, "bp": 0}, {"day": 10, "bp": 10}],
    }
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert len(body["chartData"]) == 9  # day 0 + 8 business days
    assert body["irsDailyReconciliation"] == []
    assert body["irsSettlementEvents"] == []
    # The bond math is unaffected by the missing par curve.
    assert body["chartData"][-1]["mtmPnL"] != 0
    assert body["summary"]["finalSwap"] == 0
