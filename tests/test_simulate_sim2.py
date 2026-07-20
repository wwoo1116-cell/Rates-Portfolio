"""SIM2-4 — path-true swaps: activation rule, engine validation, and the
shaped-path consistency pins.

Activation rule (build_chart_data): the additive `path_factor` array reaches
qe.simulate_irs_path_fm ONLY for a NON-TRIVIAL designed path — waypoints that
deviate from the calendar-linear ramp (target × day/simDays). Empty or
trivial-lerp paths (the golden representative fixture is exactly the trivial
lerp) stay in the legacy step/biz-ramp regime, so the absent-param
byte-identity gate is structural: golden parity keeps passing untouched.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.engine import quant_engine as qe

DATA = Path(__file__).parent / "data"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _fan_request() -> dict:
    return json.loads((DATA / "fan_non_monotone_request.json").read_text(encoding="utf-8"))


# ── 1. Absent/trivial byte-identity ─────────────────────────────────────────

def test_trivial_lerp_path_keeps_swaps_byte_identical_to_no_path(client) -> None:
    """A customPath that IS the calendar-linear ramp must not activate the
    path regime: every SWAP-side output is byte-identical to the same request
    with customPath removed (path_factor never reached the engine).

    Deliberately swap-side only: the BOND side's _factor has always evaluated
    a trivial lerp through a different float-rounding route than the t/simDays
    fallback (ulp-level, pre-existing, unchanged by SIM2-4) — full-body byte
    identity never held and is not this feature's claim. The full-request
    absent-param gate is the untouched golden parity on the representative
    fixture, whose shipped customPath is exactly the trivial lerp."""
    base = _fan_request()
    target = base["baseShockBp"]
    sim_days = base["simDays"]

    trivial = json.loads(json.dumps(base))
    trivial["customPath"] = [
        {"day": 0, "bp": 0},
        {"day": sim_days // 2, "bp": target * (sim_days // 2) / sim_days},
        {"day": sim_days, "bp": target},
    ]
    no_path = json.loads(json.dumps(base))
    no_path["customPath"] = []

    a = client.post("/api/simulate", json=trivial).json()
    b = client.post("/api/simulate", json=no_path).json()

    swap_keys = ("swapPnL", "swapThetaPnL", "swapValuationPnL")
    assert [{k: r[k] for k in swap_keys} for r in a["chartData"]] == [
        {k: r[k] for k in swap_keys} for r in b["chartData"]
    ]
    assert a["summary"]["finalSwap"] == b["summary"]["finalSwap"]
    assert a["irsDailyReconciliation"] == b["irsDailyReconciliation"]
    assert a["totalReturnDecomposition"]["swapCarry"] == b["totalReturnDecomposition"]["swapCarry"]
    assert a["totalReturnDecomposition"]["swapMtm"] == b["totalReturnDecomposition"]["swapMtm"]


# ── 2. Engine-level validation (the authorized additive param) ──────────────

def test_engine_rejects_wrong_length_and_non_finite_path() -> None:
    kwargs = dict(
        par_rates=[(0.25, 0.03), (1.0, 0.031), (5.0, 0.032)],
        notional=1e10, fixed_rate_pct=3.0, direction=1,
        t_maturity=2.0, t_next_payment=0.25, current_float_rate_pct=2.9,
        sector="IRS", shock_curve=[(0.25, 10.0), (5.0, 30.0)],
        days_to_simulate=10, base_date_str="2026-07-15",
    )
    with pytest.raises(ValueError, match="path_factor"):
        qe.simulate_irs_path_fm(**kwargs, path_factor=[0.0] * 5)  # wrong length
    bad = np.zeros(11)
    bad[3] = np.nan
    with pytest.raises(ValueError, match="path_factor"):
        qe.simulate_irs_path_fm(**kwargs, path_factor=bad)


def test_engine_default_none_matches_explicit_none() -> None:
    """path_factor=None is the byte-identical legacy path (same arrays out)."""
    kwargs = dict(
        par_rates=[(0.25, 0.03), (1.0, 0.031), (5.0, 0.032)],
        notional=1e10, fixed_rate_pct=3.0, direction=1,
        t_maturity=2.0, t_next_payment=0.25, current_float_rate_pct=2.9,
        sector="IRS", shock_curve=[(0.25, 10.0), (5.0, 30.0)],
        days_to_simulate=10, shock_type="ramp", base_date_str="2026-07-15",
    )
    a = qe.simulate_irs_path_fm(**kwargs)
    b = qe.simulate_irs_path_fm(**kwargs, path_factor=None)
    assert np.array_equal(a[0], b[0]) and np.array_equal(a[2], b[2])


# ── 3. Shaped-path consistency (the point of ruling ③) ──────────────────────

def test_shaped_path_swaps_follow_the_designed_path(client) -> None:
    """Fan fixture path: flat 0bp through D+30, ramp to +30bp by D+60. Under
    path-true swaps the swap VALUATION must be exactly flat (0) while the
    designed path is flat, move after it ramps, and the rate fan's p50 path
    must show the same flat window — chartData, ratePaths and the per-day
    decomposition telling one consistent story."""
    body = client.post("/api/simulate", json=_fan_request()).json()

    flat = [r for r in body["chartData"] if 0 < r["day"] <= 30]
    post = [r for r in body["chartData"] if r["day"] > 40]
    assert flat and post
    assert all(r["swapValuationPnL"] == 0 for r in flat), "flat path window must have zero swap valuation"
    assert any(abs(r["swapValuationPnL"]) > 1_000_000 for r in post), "post-ramp valuation must move"

    # Rate axis agrees: the center scenario's cumulative bp is 0 in the window.
    rp = {r["day"]: r["p50"] for r in body["distribution"]["ratePaths"]}
    assert all(v == 0.0 for d, v in rp.items() if d <= 30)

    # Per-day decomposition (HARDEN-1 series) stays internally consistent.
    for row in body["decompositionDaily"]:
        s = row["fundingCost"] + row["bondMtm"] + row["bondCarry"] + (row["swapMtm"] or 0) + (row["swapCarry"] or 0)
        assert s == pytest.approx(row["total"], abs=1.0)
        if 0 < row["day"] <= 30:
            assert row["swapMtm"] == pytest.approx(0.0, abs=1.0), "per-day swap valuation flat in the window"


def test_shaped_path_recon_table_rides_the_same_path(client) -> None:
    """_cum_shock_r alignment: the daily recon's Δbp is zero while the
    designed path is flat — the '추정' table follows the same trajectory the
    FM engine actually priced (no biz-ramp drift in the flat window)."""
    body = client.post("/api/simulate", json=_fan_request()).json()
    flat_rows = [r for r in body["irsDailyReconciliation"] if r["day"] <= 30]
    assert flat_rows
    for r in flat_rows:
        # dailyDbp is per-tenor; every tenor's Δbp must be zero in the window.
        assert all(v == pytest.approx(0.0, abs=0.11) for v in r["dailyDbp"].values()), r
        assert r["totalEstPnl"] == pytest.approx(0.0, abs=1.0), r


# ── SIM2-5 (ruling ④) — fundingStepping A/B pins ────────────────────────────

def _stepping_ab_request(with_events: bool) -> dict:
    req = _fan_request()
    req["fundingEvents"] = (
        [{"date": "2026-07-20", "shiftBp": -25}] if with_events else []
    )
    return req


def test_funding_stepping_flag_is_inert_without_events(client) -> None:
    """Same request ± fundingStepping, NO 금통위 events: byte-identical —
    the flag alone must change nothing."""
    off = _stepping_ab_request(with_events=False)
    on = json.loads(json.dumps(off))
    on["fundingStepping"] = True
    r_off = client.post("/api/simulate", json=off)
    r_on = client.post("/api/simulate", json=on)
    assert r_off.status_code == r_on.status_code == 200
    assert r_off.content == r_on.content


def test_funding_stepping_moves_only_funding_side_fields(client) -> None:
    """Same request ± the flag, WITH an event: the moved field set is exactly
    the funding side — fundingCurve rates/carry, the carry/total accumulators
    (chartData cumulativeCarry/totalPnL, summary finalCarry/finalTotal,
    decomposition fundingCost/total + their daily paths, distribution return
    bands). Valuation (MTM/swap), rate paths, PVBP, book P&L and exclusions
    must be byte-identical."""
    off = _stepping_ab_request(with_events=True)
    on = json.loads(json.dumps(off))
    on["fundingStepping"] = True
    a = client.post("/api/simulate", json=off).json()
    b = client.post("/api/simulate", json=on).json()

    # Funding side genuinely moved (staircase materialized).
    assert a["fundingCurve"] != b["fundingCurve"]
    assert any(p["fundingRate"] == pytest.approx(0.0260, abs=1e-12) for p in b["fundingCurve"])
    assert a["summary"]["finalCarry"] != b["summary"]["finalCarry"]

    # Everything valuation-side is byte-identical.
    assert a["pvbpSensitivity"] == b["pvbpSensitivity"]
    assert a["bookDailyPnLs"] == b["bookDailyPnLs"]
    assert a["exclusions"] == b["exclusions"]
    assert a["irsSettlementEvents"] == b["irsSettlementEvents"]
    assert a["irsDailyReconciliation"] == b["irsDailyReconciliation"]
    assert a["distribution"]["ratePaths"] == b["distribution"]["ratePaths"]
    for ra, rb in zip(a["chartData"], b["chartData"]):
        assert ra["mtmPnL"] == rb["mtmPnL"]
        assert ra["swapPnL"] == rb["swapPnL"]
        assert ra["swapThetaPnL"] == rb["swapThetaPnL"]
        assert ra["swapValuationPnL"] == rb["swapValuationPnL"]
    assert a["summary"]["finalMTM"] == b["summary"]["finalMTM"]
    assert a["summary"]["finalSwap"] == b["summary"]["finalSwap"]
    da, db = a["totalReturnDecomposition"], b["totalReturnDecomposition"]
    assert da["bondMtm"] == db["bondMtm"]
    assert da["swapMtm"] == db["swapMtm"]
    assert da["swapCarry"] == db["swapCarry"]
    assert da["fundingCost"] != db["fundingCost"]

    # The identity still closes on the stepped side, per day and at horizon.
    for row in b["decompositionDaily"]:
        s = row["fundingCost"] + row["bondMtm"] + row["bondCarry"] + (row["swapMtm"] or 0) + (row["swapCarry"] or 0)
        assert s == pytest.approx(row["total"], abs=1.0)


# ── SIM2-7 (owner ruling) — historical funding basis ────────────────────────

def test_funding_basis_resolver_pins() -> None:
    """Series facts pinned from Data/BOK Base Rate.xlsx: the 2021-11-25 MPC
    hike (0.75% → 1.00%) steps EXACTLY at the change date; 2021-11-05 sits in
    the 0.75% era (funding 0.85%); the join is the series end 2026-07-16 whose
    value equals the policy constant (NOT stale, value-continuous join);
    beyond the join the constant governs; pre-coverage dates flat-extend the
    earliest value (documented approximation, never the absurd constant)."""
    from datetime import date as _d

    from irs_pricer.services import funding_basis as fb

    assert fb.base_rate_at(_d(2021, 11, 24)) == pytest.approx(0.0075, abs=1e-12)
    assert fb.base_rate_at(_d(2021, 11, 25)) == pytest.approx(0.0100, abs=1e-12)
    assert fb.base_rate_at(_d(2021, 11, 5)) == pytest.approx(0.0075, abs=1e-12)
    assert fb.funding_rate_at(_d(2021, 11, 5)) == pytest.approx(0.0085, abs=1e-12)

    assert fb.join_date() == _d(2026, 7, 16)
    assert fb.is_stale() is False  # latest series row 0.0275 == policy constant
    assert fb.base_rate_at(_d(2026, 7, 16)) == pytest.approx(0.0275, abs=1e-12)
    assert fb.base_rate_at(_d(2026, 12, 31)) == pytest.approx(0.0275, abs=1e-12)
    # Pre-coverage: earliest series value flat-extended backward.
    assert fb.base_rate_at(_d(2015, 6, 1)) == fb.base_rate_at(_d(2016, 1, 1))


def test_strictly_future_window_keeps_the_constant(client) -> None:
    """A window that starts BEYOND the join must be byte-identical to the
    pre-SIM2-7 behavior: every strip row at the policy constant + spread."""
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
        "fundingEvents": [],
        "simDays": 30,
        "shockType": "step",
        "shockMode": "parallel",
        "baseShockBp": 0,
        "baseDate": "2026-07-17",  # first date beyond the 2026-07-16 join
        "irsCurves": [],
        "customPath": [],
    }
    body = client.post("/api/simulate", json=req).json()
    for p in body["fundingCurve"]:
        assert p["fundingRate"] == pytest.approx(0.0285, abs=1e-12), p
    assert body["fundingBasis"]["applied"] is True


def test_trace_funding_leg_accrues_at_the_historical_basis(client) -> None:
    """PnL Trace (additive funding leg): the 2021-11-05 case accrues at the
    0.85%-era rate, and the per-point rate steps to 1.10% after the real
    2021-11-25 hike — never the 2.85% constant for past dates. Cumulative
    funding is a COST (monotonically non-increasing on a positive-notional
    trade)."""
    req = {
        "swap": {
            "trade_date": "2021-11-05",
            "tenor_years": 1826 / 365,
            "maturity_date": "2026-07-03",
            "notional": 10_000_000_000,
            "fixed_rate": 0.020041506146991912,
            "pay_fixed": True,
        },
        "start_date": "2021-11-05",
        "end_date": "2021-12-31",
    }
    r = client.post("/api/mtm/npv-trace", json=req)
    assert r.status_code == 200, r.text
    pts = r.json()["points"]
    assert pts, "trace must produce points"

    first = pts[0]
    assert first["funding_rate"] == pytest.approx(0.0085, abs=1e-12)
    assert first["cumulative_funding"] == 0.0

    pre = [p for p in pts if p["valuation_date"] < "2021-11-25"]
    post = [p for p in pts if p["valuation_date"] >= "2021-11-25"]
    assert pre and post, "window must straddle the 2021-11-25 hike"
    assert all(p["funding_rate"] == pytest.approx(0.0085, abs=1e-12) for p in pre)
    assert all(p["funding_rate"] == pytest.approx(0.0110, abs=1e-12) for p in post)

    cum = [p["cumulative_funding"] for p in pts]
    assert all(b <= a + 1e-9 for a, b in zip(cum, cum[1:])), "funding is a cost"
    # Envelope: 56 calendar days ≈ 20d @0.85% + 36d @1.10% on 100억 ≈ −15.5M
    # (measured −15,575,342 — the 2.85% constant would be ≈ −43.7M).
    assert -20_000_000 < cum[-1] < -10_000_000
