"""s18 — carry A/B residual pin (T2), dual-axis rate paths (T3), Seoul-baseDate
swap inclusion (T4).

T2 background: two live observations (Carry −93.8bp @ 운용 3.26% vs +82.1bp @
운용 3.42%) differed by more than the funding delta. They came from different
books AND different base dates, so the residual was an observation mismatch —
but the claim "purely the funding artifact" was unverified. This A/B holds
book + base date + scenario fixed and pins that the ONLY thing funding changes
is funding: 운용 byte-identical, carry delta == funding delta, residual 0.

T3: the fan is axis-separated. distribution.ratePaths carries each quantile
scenario's 국채 3Y cumulative-bp path — rates are monotone in the quantile by
construction, so those bands may NEVER cross (P-labels are truthful there).
The return bands stay scenario-keyed and MAY cross (rank labels are banned on
that panel, pinned FE-side).
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.services import simulation_service

DATA = Path(__file__).parent / "data"

FAN_NON_MONOTONE_REQUEST = json.loads(
    (DATA / "fan_non_monotone_request.json").read_text(encoding="utf-8")
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


BOND = {
    "id": "b1", "name": "KTB", "book": "RP Fund", "bondType": "bond",
    "sector": "국고채", "couponRate": 3.0, "notional": 10_000_000_000,
    "evaluationAmount": 10_000_000_000, "mtmYield": 3.0,
    "duration": 1.0, "pvbp": 1_000_000, "tenor": "1Y",
    "remainingDays": 365, "krdMap": {"1Y": 1_000_000},
}


def _base_request(**overrides) -> dict:
    req = {
        "positions": [dict(BOND)],
        "shockCurves": {"bondCurves": {}, "swapCurve": []},
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        "fundingEvents": [],
        "simDays": 30,
        "shockType": "ramp",
        "shockMode": "parallel",
        "baseShockBp": 10,
        "baseDate": "2026-07-14",
        "irsCurves": [],
        "customPath": [],
    }
    req.update(overrides)
    return req


# ── T2: same-book / same-base-date / same-scenario A/B ───────────────────────

def test_carry_ab_only_funding_moves(client: TestClient) -> None:
    """A = legacy explicit fundingRate 0.042; B = omitted (constant 0.0285).
    Same book, same base date, same scenario. Expected: 운용(positionRate)
    byte-identical on every strip row, carry delta == funding delta exactly
    (±0.1bp per the task spec; measured well inside), residual 0."""
    r_a = client.post("/api/simulate", json=_base_request(fundingRate=0.042))
    r_b = client.post("/api/simulate", json=_base_request())
    assert r_a.status_code == 200 and r_b.status_code == 200
    fa = r_a.json()["fundingCurve"]
    fb = r_b.json()["fundingCurve"]

    assert [p["day"] for p in fa] == [p["day"] for p in fb]
    # [CHANGED, SIM2-7] the omitted-funding side is the HISTORICAL staircase
    # (2.60% through 2026-07-15, 2.85% from the 07-16 hike), so the per-row
    # funding delta varies by segment — the funding-only ISOLATION assertion
    # itself survives: carry delta == funding delta per row, MTM byte-equal,
    # and the carry gap equals the strip-integral of the per-day difference.
    for pa, pb in zip(fa, fb):
        # The operating yield must not know about funding at all.
        assert pa["positionRate"] == pb["positionRate"], (pa, pb)
        assert pa["fundingRate"] == pytest.approx(0.042, abs=1e-12)
        want_b = 0.0260 if pb["date"] <= "2026-07-15" else 0.0285
        assert pb["fundingRate"] == pytest.approx(want_b, abs=1e-12), pb
        if pa["carryBp"] is not None:
            assert pb["carryBp"] - pa["carryBp"] == pytest.approx(
                (0.042 - pb["fundingRate"]) * 10000.0, abs=0.1
            ), f"day {pa['day']}: carry residual beyond funding delta"

    # And the P&L side agrees: same MTM (funding never touches valuation),
    # carry differs by exactly the funding accrual difference on this book.
    a, b = r_a.json()["summary"], r_b.json()["summary"]
    assert a["finalMTM"] == b["finalMTM"]
    accrual_diff = 0.0
    for prev, cur in zip(fb, fb[1:]):
        accrual_diff += 10_000_000_000 * (0.042 - cur["fundingRate"]) * (cur["day"] - prev["day"]) / 365.0
    assert (a["finalCarry"] - b["finalCarry"]) == pytest.approx(-accrual_diff, abs=2.0)


# ── T3: rate paths — the axis where P-labels are truthful ────────────────────

def _rate_paths(body: dict) -> list[dict]:
    dist = body["distribution"]
    assert dist is not None and "ratePaths" in dist
    return dist["ratePaths"]


def test_rate_paths_shape_and_center(client: TestClient) -> None:
    r = client.post("/api/simulate", json=_base_request(sigma_bp=2.0))
    assert r.status_code == 200
    body = r.json()
    rp = _rate_paths(body)
    bands = body["distribution"]["bands"]
    assert [x["day"] for x in rp] == [b["day"] for b in bands]
    # p50 rate path == the base scenario's own path (ramp to +10bp over 30d).
    last = rp[-1]
    assert last["p50"] == pytest.approx(10.0, abs=1e-9)
    # Terminal quantile offsets = z * sigma_t around the base path.
    # sigmaTerminalBp is rounded to 4dp in the response → tolerance z*5e-5.
    sigma_t = body["distribution"]["sigmaTerminalBp"]
    assert last["p95"] - last["p50"] == pytest.approx(1.6448536269514722 * sigma_t, abs=2e-4)
    assert last["p50"] - last["p5"] == pytest.approx(1.6448536269514722 * sigma_t, abs=2e-4)


@pytest.mark.parametrize("sigma", [2.0, 7.5])
def test_rate_bands_never_cross(client: TestClient, sigma: float) -> None:
    """Rates are monotone in the quantile by construction — the rate fan's
    P5≤P25≤P50≤P75≤P95 ordering must hold on EVERY day, any σ."""
    r = client.post("/api/simulate", json=_base_request(sigma_bp=sigma))
    assert r.status_code == 200
    for row in _rate_paths(r.json()):
        assert row["p5"] <= row["p25"] <= row["p50"] <= row["p75"] <= row["p95"], row


# ── T3 on the non-monotone LIVE-BOOK fixture: both axes, one request ─────────

def test_fixture_rate_bands_ordered_while_return_lines_cross(client: TestClient) -> None:
    """The dual-axis pin on the live-book fixture, all in one response:
    (a) rate bands never cross (truthful P-labels on the rate axis),
    (b) the return lines DO cross (the non-monotone information preserved),
    (c) the center return line is the base run byte-equal (invariant kept).

    [CHANGED, SIM2-4 ruling] same overshoot-path variant as
    test_fan_scenario_identity_non_monotone_book: path-true swaps made the
    committed fixture monotone; the crossing coverage now rides an overshoot
    path (0 → +60bp@D30 → +30bp@D60) while the fixture file stays
    byte-stable for the cache/HARDEN-1 pins."""
    req = dict(FAN_NON_MONOTONE_REQUEST)
    req["customPath"] = [
        {"day": 0, "bp": 0},
        {"day": 30, "bp": 60.0},
        {"day": 60, "bp": 30.0},
    ]
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()

    # (a) rate axis: ordered everywhere
    for row in _rate_paths(body):
        assert row["p5"] <= row["p25"] <= row["p50"] <= row["p75"] <= row["p95"], row

    # (b) return axis: at least one label-order crossing survives
    def ordered(b: dict) -> bool:
        vals = [b["p5"], b["p25"], b["p50"], b["p75"], b["p95"]]
        return all(vals[i] <= vals[i + 1] for i in range(4)) or all(
            vals[i] >= vals[i + 1] for i in range(4)
        )
    bands = body["distribution"]["bands"]
    assert any(not ordered(b) for b in bands), "fixture regressed to monotone"

    # (c) center identity
    chart = {row["day"]: row["totalPnL"] for row in body["chartData"]}
    for b in bands:
        assert b["p50"] == chart[b["day"]]


# ── T4: the Seoul-resolved base date keeps the swap book priced ──────────────

def test_seoul_resolved_base_date_keeps_swaps_included(client: TestClient, monkeypatch) -> None:
    """FE clock fakes (position-bridge.test.ts) pin that 08:30 KST and 09:30
    KST both resolve baseDate to 2026-07-16. This is the BE half: with same-day
    quotes present for THAT date, the swap book prices — no exclusion. (Under
    the old UTC derivation the 08:30 run sent the previous day; on Mondays that
    was a Sunday → NonBusinessDayError → the whole swap book silently blank.)"""
    snapshot = MarketSnapshot(
        valuation_date=date(2026, 7, 16),
        cd_rate=0.0251,
        swap_quotes=[
            RateQuote(tenor_years=0, rate=0.0250, tenor_months=3),
            RateQuote(tenor_years=1, rate=0.0280, tenor_months=12),
            RateQuote(tenor_years=2, rate=0.0300, tenor_months=24),
            RateQuote(tenor_years=5, rate=0.0320, tenor_months=60),
        ],
    )
    monkeypatch.setattr(
        simulation_service.market_data_service, "load_snapshot",
        lambda d: snapshot if d == date(2026, 7, 16) else (_ for _ in ()).throw(ValueError(d)),
    )
    monkeypatch.setattr(
        simulation_service.market_data_service, "load_fixings",
        lambda: {date(2026, 7, 15): 0.0251},
    )
    swap = {
        "id": "s1", "name": "IRS 2Y rec", "book": "Trading", "bondType": "swap",
        "sector": "IRS", "couponRate": 3.0, "notional": 10_000_000_000,
        "direction": 1, "startDate": "2025-07-16", "maturityDate": "2027-07-16",
        "currentFloatRate": 0.0, "krdMap": {},
    }
    r = client.post("/api/simulate", json=_base_request(
        positions=[dict(BOND), swap], baseDate="2026-07-16",
    ))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exclusions"] == []
    assert body["summary"]["finalSwap"] != 0
