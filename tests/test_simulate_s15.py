"""s15 — funding spec (T1), swap intake + honest exclusion + TR decomposition
(T2), and fan scenario identity on a non-monotone real-book fixture (T4).

Funding spec (owner decision, 2026-07-16): with `fundingRate` OMITTED from the
request — the live bridge's payload — funding is 기준금리 + 10bp, one constant
for the whole horizon, no fundingEvents stepping. Explicit fundingRate keeps
the source semantics (test_simulate_api's golden parity path).

Swap intake: the S6 bridge sends swaps with empty irsCurves; the backend
resolves par quotes from its own snapshot store for the base date. No quotes →
swaps are EXCLUDED explicitly (response.exclusions) — never silently zeroed,
never priced off another date's snapshot. Market-data access is monkeypatched
here so the tests are deterministic and Data-folder-independent.

Fan fixture: tests/data/fan_non_monotone_request.json is a LIVE-BOOK capture
(2026-07-15: one real bond + one real pay-fixed IRS whose DV01s roughly offset,
market inputs frozen into the request) that produces label-order crossings —
the case the removed per-day sorting used to distort (iv3 defect: base run
rendered at p25). It closes the affine-only blind spot of the σ tests.
"""

from __future__ import annotations

import json
import math
from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.services import simulation_service

DATA = Path(__file__).parent / "data"

REPRESENTATIVE_REQUEST = json.loads(
    (DATA / "simulate_request_representative.json").read_text(encoding="utf-8")
)
FAN_NON_MONOTONE_REQUEST = json.loads(
    (DATA / "fan_non_monotone_request.json").read_text(encoding="utf-8")
)


@pytest.fixture(scope="module")
def client() -> TestClient:
    return TestClient(app)


# ── shared fixtures ──────────────────────────────────────────────────────────

BOND = {
    "id": "b1", "name": "KTB", "book": "RP Fund", "bondType": "bond",
    "sector": "국고채", "couponRate": 3.0, "notional": 10_000_000_000,
    "evaluationAmount": 10_000_000_000, "mtmYield": 3.0,
    "duration": 1.0, "pvbp": 1_000_000, "tenor": "1Y",
    "remainingDays": 365, "krdMap": {"1Y": 1_000_000},
}

SWAP = {
    # Contract terms only — the bridge's shape: no pvbp/krdMap/fixing fields.
    "id": "s1", "name": "IRS 2Y rec", "book": "Trading", "bondType": "swap",
    "sector": "IRS", "couponRate": 3.0, "notional": 10_000_000_000,
    "direction": 1, "startDate": "2025-07-14", "maturityDate": "2027-07-14",
    "currentFloatRate": 0.0, "krdMap": {},
}

SNAPSHOT = MarketSnapshot(
    valuation_date=date(2026, 7, 14),
    cd_rate=0.0251,
    swap_quotes=[
        RateQuote(tenor_years=0, rate=0.0250, tenor_months=3),
        RateQuote(tenor_years=1, rate=0.0260, tenor_months=6),
        RateQuote(tenor_years=1, rate=0.0280, tenor_months=12),
        RateQuote(tenor_years=2, rate=0.0300, tenor_months=24),
        RateQuote(tenor_years=3, rate=0.0310, tenor_months=36),
        RateQuote(tenor_years=5, rate=0.0320, tenor_months=60),
    ],
)

FIXINGS = {date(2026, 7, 10): 0.0250, date(2026, 7, 13): 0.0251}


def _base_request(positions: list[dict], **overrides) -> dict:
    req = {
        "positions": positions,
        "shockCurves": {"bondCurves": {}, "swapCurve": []},
        "dailyShockCurves": {"bondCurves": {}, "swapCurve": []},
        # fundingRate deliberately OMITTED — the live bridge's payload.
        "fundingEvents": [],
        "simDays": 30,
        "shockType": "step",
        "shockMode": "parallel",
        "baseShockBp": 10,
        "baseDate": "2026-07-14",
        "irsCurves": [],
        "customPath": [],
    }
    req.update(overrides)
    return req


def _decomposition_sum(d: dict) -> float:
    return sum(
        d[k] for k in ("bondMtm", "bondCarry", "fundingCost", "swapMtm", "swapCarry")
        if d[k] is not None
    )


# ── T1: funding = 기준금리 + 10bp, fixed for the horizon ─────────────────────

def test_funding_constants_spec() -> None:
    """s18 T1 — pins BOTH the manually maintained policy constant and the
    derived funding rate, so a silent drift of either fails loudly. Current
    value: 2.75%, effective 2026-07-16 (MPC hike from 2.50%). This constant is
    deliberately NOT derived from the repo's BOK Base Rate series (it lags the
    decision); update the constant AND this pin together on the next change."""
    assert simulation_service.POLICY_BASE_RATE_KRW == 0.0275
    assert simulation_service.FUNDING_SPREAD_BP == 10
    assert simulation_service.FUNDING_RATE_KRW == pytest.approx(0.0285, abs=1e-15)


def test_home_funding_rate_uses_policy_constant(client: TestClient) -> None:
    """iv4 T5 — Home(Daily P&L by Book)과 시뮬레이션은 같은 상수에서 조달금리를
    유도한다. Home이 다시 BOK 시리즈(또는 제2의 하드코딩 값)로 표류하면 여기서
    깨진다: 두 패널이 화면에서 25bp 어긋나던 것이 이 재배선의 이유였다."""
    from irs_pricer.services import portfolio_analytics_service as pas

    assert pas.home_funding_rate(10.0) == pytest.approx(
        simulation_service.FUNDING_RATE_KRW, abs=1e-15
    )
    assert pas.home_funding_rate(0.0) == simulation_service.POLICY_BASE_RATE_KRW
    assert pas.home_funding_rate(None) == simulation_service.POLICY_BASE_RATE_KRW

    # The FE-facing single source: /api/portfolio/funding-rate mirrors the pair.
    r = client.get("/api/portfolio/funding-rate")
    assert r.status_code == 200
    body = r.json()
    assert body["policy_base_rate"] == simulation_service.POLICY_BASE_RATE_KRW
    assert body["funding_rate_default"] == pytest.approx(0.0285, abs=1e-15)


def test_funding_omitted_stays_constant_when_stepping_off(client: TestClient) -> None:
    """[CHANGED, SIM2-7 ruling — historical basis; supersedes the SIM2-5
    re-spec's rate rows] With stepping OFF, funding is the HISTORICAL
    staircase: series-covered dates fund at the actual BOK base rate + 10bp
    (2026-07-14/15 → 2.50%+10bp = 2.60%), and from the join (2026-07-16, the
    real MPC hike row: 2.75%) the series and the policy constant agree at
    2.85% — one continuous staircase, still NO user-event stepping. The
    per-row carry identity and the strip-integral finalCarry hold."""
    req = _base_request(
        [dict(BOND)],
        baseShockBp=0,  # no rate shock — isolates the carry arithmetic
        fundingEvents=[{"date": "2026-07-20", "shiftBp": -25}],
    )
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()

    fc = body["fundingCurve"]
    assert len(fc) > 1
    for p in fc:
        # Historical stairs: 2.60% through 2026-07-15, 2.85% from the hike.
        want = 0.0260 if p["date"] <= "2026-07-15" else 0.0285
        assert p["fundingRate"] == pytest.approx(want, abs=1e-12), p
        if p["positionRate"] is not None:
            # 0.1bp regression bound from the task spec (0.005bp measured).
            assert p["carryBp"] == pytest.approx(
                (p["positionRate"] - p["fundingRate"]) * 10000.0, abs=0.1
            ), p
    assert {round(p["fundingRate"], 4) for p in fc} == {0.0260, 0.0285}, "straddle must show the step"

    # Strip-integral identity (same convention as the stepping-on case).
    expected = 0.0
    for prev, cur in zip(fc, fc[1:]):
        expected += 10_000_000_000 * (0.030 - cur["fundingRate"]) * (cur["day"] - prev["day"]) / 365
    assert body["summary"]["finalCarry"] == pytest.approx(expected, abs=2.0)
    # Provenance rides the response (SIM2-7): applied, join at the series end.
    fb = body["fundingBasis"]
    assert fb["applied"] is True and fb["joinDate"] == "2026-07-16" and fb["stale"] is False


def test_funding_omitted_steps_when_stepping_on(client: TestClient) -> None:
    """[SIM2-5 ruling ④ — the stepping-ON case] fundingStepping=true + omitted
    fundingRate: fixed-mode funding STEPS at the 금통위 date via the existing
    calc_dynamic_funding_rate mechanism, base = the policy constant pair
    (0.0285 before the event, 0.0260 from it). The per-row carry identity —
    the funding-only isolation — must survive on stepped rows, and finalCarry
    equals the two-segment accrual arithmetic."""
    req = _base_request(
        [dict(BOND)],
        baseShockBp=0,
        fundingEvents=[{"date": "2026-07-20", "shiftBp": -25}],
        fundingStepping=True,
    )
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()

    fc = body["fundingCurve"]
    assert len(fc) > 1
    stepped = [p for p in fc if p["date"] >= "2026-07-20"]
    flat = [p for p in fc if p["date"] < "2026-07-20"]
    assert stepped and flat, "window must straddle the event"
    # [CHANGED, SIM2-7] the pre-event base is the HISTORICAL staircase (2.60%
    # through 07-15, 2.85% from the 07-16 hike); the -25bp user event stacks
    # on the base governing from 07-20 (2.85% − 25bp = 2.60%).
    for p in flat:
        want = 0.0260 if p["date"] <= "2026-07-15" else 0.0285
        assert p["fundingRate"] == pytest.approx(want, abs=1e-12), p
    for p in stepped:
        assert p["fundingRate"] == pytest.approx(0.0260, abs=1e-12), p
    # The isolation identity survives stepping: carry == 운용 − funding per row.
    for p in fc:
        if p["positionRate"] is not None:
            assert p["carryBp"] == pytest.approx(
                (p["positionRate"] - p["fundingRate"]) * 10000.0, abs=0.1
            ), p

    # Strip-integral identity: finalCarry == Σ (mtmYield − fundingRate_row) ×
    # Δday over the response's own staircase (the business-day loop applies a
    # row's rate across its calendar gap, so the strip IS the accrual spec —
    # no parallel reconstruction of the biz-day schedule here).
    expected = 0.0
    for prev, cur in zip(fc, fc[1:]):
        expected += 10_000_000_000 * (0.030 - cur["fundingRate"]) * (cur["day"] - prev["day"]) / 365
    assert body["summary"]["finalCarry"] == pytest.approx(expected, abs=2.0)
    # And the staircase genuinely raised carry vs the constant case (a cut
    # widens the spread): constant-case value from the stepping-off twin.
    assert body["summary"]["finalCarry"] > round(30 * 10_000_000_000 * 0.0015 / 365)


def test_funding_explicit_value_keeps_source_stepping(client: TestClient) -> None:
    """Explicit fundingRate == the legacy source semantics: the strip steps by
    fundingEvents (golden-parity path, unchanged by s15)."""
    req = _base_request(
        [dict(BOND)],
        baseShockBp=0,
        fundingRate=0.03,
        fundingEvents=[{"date": "2026-07-20", "shiftBp": -25}],
    )
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    fc = r.json()["fundingCurve"]
    assert fc[0]["fundingRate"] == pytest.approx(0.03)
    assert fc[-1]["fundingRate"] == pytest.approx(0.0275)


# ── T2: swaps into the simulation ────────────────────────────────────────────

def test_swaps_priced_from_snapshot_store(client: TestClient, monkeypatch) -> None:
    """Bridge-shaped payload (swaps, empty irsCurves): par rates come from the
    snapshot store for the base date; the current-period CD fixing and next
    fixing date resolve from the fixing store; swaps price through the FM path
    and the decomposition reconciles to Total Return within ±₩1."""
    monkeypatch.setattr(
        simulation_service.market_data_service, "load_snapshot", lambda d: SNAPSHOT
    )
    monkeypatch.setattr(
        simulation_service.market_data_service, "load_fixings", lambda: FIXINGS
    )
    r = client.post("/api/simulate", json=_base_request([dict(BOND), dict(SWAP)]))
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["exclusions"] == []
    # The par curve reached the engine: the daily KRD reconciliation ran.
    assert len(body["irsDailyReconciliation"]) > 0
    # The swap actually contributes P&L (receive-fixed 3.0% vs ~2.8% par book,
    # +10bp step) — not a silent zero.
    assert body["summary"]["finalSwap"] != 0
    # Enriched KRD flowed into the sensitivity table.
    irs_row = next(row for row in body["pvbpSensitivity"] if row["sector"] == "IRS")
    assert irs_row["total"] != 0

    d = body["totalReturnDecomposition"]
    assert d["swapMtm"] is not None and d["swapCarry"] is not None
    assert math.isclose(_decomposition_sum(d), d["total"], abs_tol=1e-6)
    assert d["total"] == pytest.approx(body["summary"]["finalTotal"], abs=1.0)


def test_swaps_excluded_when_no_quotes(client: TestClient, monkeypatch) -> None:
    """Owner decision: no same-day IRS quotes → exclude swaps and SAY SO. No
    snapshot fallback, no silent zeros, no 500 — bond outputs stay intact."""
    def _no_data(d):
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    monkeypatch.setattr(simulation_service.market_data_service, "load_snapshot", _no_data)

    r = client.post("/api/simulate", json=_base_request([dict(BOND), dict(SWAP)]))
    assert r.status_code == 200, r.text
    body = r.json()

    assert body["exclusions"] == [{
        "assetClass": "swap",
        "reason": "당일 IRS 호가 없음",
        "asOf": "2026-07-14",
    }]
    # Swaps are OUT of every numeric surface (excluded ≠ zero-priced): the
    # trajectory carries no swap P&L and the decomposition marks it undefined.
    assert all(row["swapPnL"] == 0 for row in body["chartData"])
    assert body["irsDailyReconciliation"] == []
    assert body["irsSettlementEvents"] == []
    d = body["totalReturnDecomposition"]
    assert d["swapMtm"] is None and d["swapCarry"] is None
    assert d["total"] == pytest.approx(body["summary"]["finalTotal"], abs=1.0)
    # Bond outputs unaffected by the exclusion.
    assert body["chartData"][-1]["mtmPnL"] != 0


def test_swaps_excluded_when_snapshot_has_no_irs_quotes(client: TestClient, monkeypatch) -> None:
    empty = MarketSnapshot(valuation_date=date(2026, 7, 14), cd_rate=0.0251, swap_quotes=[])
    monkeypatch.setattr(simulation_service.market_data_service, "load_snapshot", lambda d: empty)
    r = client.post("/api/simulate", json=_base_request([dict(BOND), dict(SWAP)]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["assetClass"] for x in body["exclusions"]] == ["swap"]


def test_explicit_irs_curves_bypass_the_store(client: TestClient, monkeypatch) -> None:
    """A request that carries its own irsCurves (old payloads, goldens, frozen
    fixtures) must never touch the snapshot store."""
    def _must_not_be_called(d):
        raise AssertionError("load_snapshot must not be called when irsCurves are explicit")
    monkeypatch.setattr(simulation_service.market_data_service, "load_snapshot", _must_not_be_called)
    monkeypatch.setattr(simulation_service.market_data_service, "load_fixings", lambda: FIXINGS)

    swap = dict(SWAP, currentFloatRate=2.81, remainingDays=365)
    req = _base_request(
        [dict(BOND), swap],
        irsCurves=[{"t": 1.0, "rate": 0.028}, {"t": 2.0, "rate": 0.030}, {"t": 5.0, "rate": 0.032}],
    )
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    assert r.json()["exclusions"] == []


def test_swap_float_fields_resolved_from_fixing_store(monkeypatch) -> None:
    """_resolve_swap_float_fields fills the bridge's unset market fields from
    the SAME sources the real-book MtM path uses: IRS_Trade schedule (ISDA) +
    select_fixing (reset-date rule, F(R)=R−1 Seoul BD)."""
    monkeypatch.setattr(
        simulation_service.market_data_service, "load_fixings", lambda: FIXINGS
    )
    pos = simulation_service.FrontendPosition(**SWAP)
    (resolved,) = [
        p for p in simulation_service._resolve_swap_float_fields([pos], "2026-07-14")
    ]
    # Reset date 2026-07-14 (a quarterly pay date) → F(R) = 2026-07-13 → 2.51%.
    assert resolved.currentFloatRate == pytest.approx(2.51)
    nfd = date.fromisoformat(resolved.nextFixingDate)
    assert date(2026, 7, 14) < nfd <= date(2026, 11, 1)  # next quarterly reset
    assert resolved.remainingDays == pytest.approx((date(2027, 7, 14) - date(2026, 7, 14)).days)


def test_decomposition_sums_on_representative_book(client: TestClient) -> None:
    """The golden-parity book (bonds + 2 IRS + BOK cut + explicit funding):
    the s15 decomposition must reconcile to the pinned finalTotal within ±₩1
    with NO parallel math — it is the same engine accumulators factored."""
    r = client.post("/api/simulate", json=REPRESENTATIVE_REQUEST)
    assert r.status_code == 200, r.text
    body = r.json()
    d = body["totalReturnDecomposition"]
    assert d["swapMtm"] is not None
    assert math.isclose(_decomposition_sum(d), d["total"], abs_tol=1e-6)
    assert d["total"] == pytest.approx(body["summary"]["finalTotal"], abs=1.0)
    # And it agrees with the summary lines it refines: bond carry splits into
    # gross carry + funding cost without changing their sum.
    assert d["bondCarry"] + d["fundingCost"] == pytest.approx(
        body["summary"]["finalCarry"], abs=1.0
    )
    assert d["bondMtm"] == pytest.approx(body["summary"]["finalMTM"], abs=1.0)
    assert d["swapMtm"] + d["swapCarry"] == pytest.approx(
        body["summary"]["finalSwap"], abs=1.0
    )


# ── T4: fan scenario identity on a non-monotone LIVE-BOOK fixture ───────────

def _band_values(band: dict) -> list[float]:
    return [band["p5"], band["p25"], band["p50"], band["p75"], band["p95"]]


def _is_label_ordered(band: dict) -> bool:
    vals = _band_values(band)
    asc = all(vals[i] <= vals[i + 1] for i in range(4))
    desc = all(vals[i] >= vals[i + 1] for i in range(4))
    return asc or desc


def test_fan_scenario_identity_non_monotone_book(client: TestClient) -> None:
    """Live-book capture whose totalPnL is NOT monotone in the parallel offset:
    (1) the center band equals the base run BYTE-EQUAL on every day, and
    (2) label-order crossings SURVIVE into the response — under the removed
        per-day sorting they were impossible (bands were always ordered), so
        their presence pins that runs are no longer migrated across ranks.

    [CHANGED, SIM2-4 ruling] path-true swaps made the committed fixture's
    back-loaded path monotone (the swap legs now ride the same designed path
    as the bonds, which removed the mid-horizon divergence that crossed the
    scenarios). Non-monotone coverage is kept with an OVERSHOOT path variant
    (0 → +60bp@D30 → +30bp@D60 — exactly the kind of shape SIM2-3 drag makes
    expressible); the committed fixture file itself stays byte-stable for the
    s21 cache and HARDEN-1 pins."""
    req = dict(FAN_NON_MONOTONE_REQUEST)
    req["customPath"] = [
        {"day": 0, "bp": 0},
        {"day": 30, "bp": 60.0},
        {"day": 60, "bp": 30.0},
    ]
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exclusions"] == []

    chart = {row["day"]: row["totalPnL"] for row in body["chartData"]}
    bands = body["distribution"]["bands"]
    assert [b["day"] for b in bands] == sorted(chart.keys())
    for b in bands:
        assert b["p50"] == chart[b["day"]], f"day {b['day']}: center must BE the base run"

    crossing_days = [b["day"] for b in bands if not _is_label_ordered(b)]
    assert crossing_days, "fixture regressed to monotone — non-monotone coverage lost"


def test_fan_center_is_base_under_any_sigma(client: TestClient) -> None:
    """σ-independence of the center on the SAME non-monotone book: scaling σ
    reshapes the bands but never moves p50 off the base trajectory."""
    req = dict(FAN_NON_MONOTONE_REQUEST)
    req["sigma_bp"] = 7.5
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    chart = {row["day"]: row["totalPnL"] for row in body["chartData"]}
    for b in body["distribution"]["bands"]:
        assert b["p50"] == chart[b["day"]]
    assert body["distribution"]["sigmaBpDaily"] == 7.5
