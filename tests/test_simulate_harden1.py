"""HARDEN-1 — swap-carry adjudication fix + per-day decomposition pins.

Adjudication A (route ii) evidence: quant_engine.simulate_irs_path_fm hard-zeros
its daily_carry output (quant_engine.py:1474, `daily_carry[day] = 0.0`) and folds
all settled cash into the dirty mtm_pnl, so the pre-HARDEN-1 decomposition
reported swapMtm = full dirty swap P&L and swapCarry = 0.0 on EVERY request
(both committed s21 fixtures reproduced this: fan swapMtm=92,053,141.59 /
swapCarry=0.0; representative swapMtm=26,167,885.32 / swapCarry=0.0).

Fix (service-layer only, no quant_engine change, no parallel math): swap
components are re-split on the theta/valuation axis the loop already computes
for chartData — swapCarry = theta P&L (curve frozen at base_date, time passage
+ settled CF), swapMtm = valuation P&L (actual − theta). Their sum, the bond
components, fundingCost and total are unchanged.

Pinned before → after on the committed fixtures:
  fan_non_monotone_request.json:
    swapMtm   92,053,141.59189904 → 134,446,996.41759253
    swapCarry  0.0                → -42,393,854.82569349
  simulate_request_representative.json:
    swapMtm   26,167,885.319990844 → 25,036,628.398704525
    swapCarry  0.0                 → 1,131,256.9212863185
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from irs_pricer.api.app import app
from irs_pricer.services import simulation_service

DATA = Path(__file__).parent / "data"

DECOMP_KEYS = ("fundingCost", "bondMtm", "bondCarry", "swapMtm", "swapCarry")


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _post(client: TestClient, fixture: str) -> dict:
    req = json.loads((DATA / fixture).read_text(encoding="utf-8"))
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    return r.json()


def _row_sum(row: dict) -> float:
    return sum(row[k] for k in DECOMP_KEYS if row[k] is not None)


# ── 1. Swap carry is REAL (nonzero) and theta-symmetric ─────────────────────

def test_swap_carry_nonzero_and_pinned_on_fan_fixture(client) -> None:
    """The point of the fix: swapCarry was 0.0 by engine construction; it is
    now the theta P&L.

    [CHANGED, SIM2-4 ruling] the fan fixture's shaped customPath now drives
    the swap legs too (path-true), so the VALUATION side and total moved:
    swapMtm 134,446,996.42 → 125,508,190.66 and total 37,128,110.35 →
    28,189,304.59 (refixings crystallize mid-horizon path effects — the
    designed behavior, not drift). Theta (swapCarry) is base-curve-driven and
    unchanged; bond components and funding are untouched by construction."""
    body = _post(client, "fan_non_monotone_request.json")
    d = body["totalReturnDecomposition"]

    assert d["swapCarry"] != 0.0
    assert d["swapCarry"] == pytest.approx(-42_393_854.82569349, abs=1.0)
    assert d["swapMtm"] == pytest.approx(125_508_190.65524912, abs=1.0)
    assert d["swapMtm"] + d["swapCarry"] == pytest.approx(83_114_335.82955563, abs=1.0)
    # Unchanged components (pre-fix captures, exact to the float).
    # [CHANGED, DV01-B] bondMtm −75,833,596.48720416 → −50,977,444.638177246
    # (and total by exactly that delta, +24,856,151.849): the fixture's wire
    # pvbp is a frozen-blotter figure, now re-derived via bond_risk reval at
    # the request base date (enrich_bond_dv01). bondCarry / fundingCost /
    # swapMtm / swapCarry are BYTE-IDENTICAL — only the bond sensitivity leg
    # consumes the replaced pvbp (derivation: DV01_FIX_REPORT.md Phase B).
    assert d["bondMtm"] == pytest.approx(-50_977_444.638177246, abs=1e-3)
    assert d["bondCarry"] == pytest.approx(285_483_035.32653785, abs=1e-3)
    assert d["fundingCost"] == pytest.approx(-264_574_470.08219185, abs=1e-3)
    assert d["total"] == pytest.approx(53_045_456.43572441, abs=1e-3)


def test_swap_carry_pinned_on_representative_fixture(client) -> None:
    body = _post(client, "simulate_request_representative.json")
    d = body["totalReturnDecomposition"]
    assert d["swapCarry"] == pytest.approx(1_131_256.9212863185, abs=1.0)
    assert d["swapMtm"] == pytest.approx(25_036_628.398704525, abs=1.0)
    assert d["swapMtm"] + d["swapCarry"] == pytest.approx(26_167_885.319990844, abs=1.0)


def test_five_components_sum_to_total_with_nonzero_swap_carry(client) -> None:
    """The ±₩1 identity on a fixture where swap carry ≠ 0 (the spec's pin)."""
    body = _post(client, "fan_non_monotone_request.json")
    d = body["totalReturnDecomposition"]
    assert d["swapCarry"] != 0.0
    assert math.isclose(_row_sum(d), d["total"], abs_tol=1.0)
    assert d["total"] == pytest.approx(body["summary"]["finalTotal"], abs=1.0)


def test_swap_split_matches_chart_theta_valuation_series(client) -> None:
    """No parallel math: the decomposition swap split IS the unrounded source
    of chartData's swapThetaPnL/swapValuationPnL final entries."""
    body = _post(client, "fan_non_monotone_request.json")
    d = body["totalReturnDecomposition"]
    last = body["chartData"][-1]
    assert d["swapCarry"] == pytest.approx(last["swapThetaPnL"], abs=1.0)
    assert d["swapMtm"] == pytest.approx(last["swapValuationPnL"], abs=1.0)


# ── 2. Per-day decomposition series ─────────────────────────────────────────

def test_decomposition_daily_identity_every_day(client) -> None:
    """Five daily cumulative paths sum to the daily total within ±₩1 on every
    day; the final day equals totalReturnDecomposition; the daily axis matches
    chartData's."""
    for fixture in ("fan_non_monotone_request.json", "simulate_request_representative.json"):
        body = _post(client, fixture)
        dd = body["decompositionDaily"]
        assert len(dd) == len(body["chartData"]) > 0

        for row in dd:
            assert math.isclose(_row_sum(row), row["total"], abs_tol=1.0), (fixture, row)

        last, d = dd[-1], body["totalReturnDecomposition"]
        for k in (*DECOMP_KEYS, "total"):
            assert last[k] == pytest.approx(d[k], abs=1e-6), (fixture, k)
        assert last["total"] == pytest.approx(body["summary"]["finalTotal"], abs=1.0)
        assert [r["day"] for r in dd] == [p["day"] for p in body["chartData"]]


def test_decomposition_daily_blank_policy_on_swap_exclusion(client, monkeypatch) -> None:
    """Excluded swaps: per-day swap components are null (undefined), never 0,
    and the daily total is the bond-side sum — mirroring the final
    decomposition's s15 nulling."""
    def _no_data(_d):
        raise ValueError("사용 가능한 시장 데이터가 없습니다.")
    monkeypatch.setattr(simulation_service.market_data_service, "load_snapshot", _no_data)

    req = json.loads((DATA / "fan_non_monotone_request.json").read_text(encoding="utf-8"))
    # Bridge-shaped swap: empty irsCurves forces the snapshot-store path → exclusion.
    req["irsCurves"] = []
    r = client.post("/api/simulate", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    assert any(x["assetClass"] == "swap" for x in body["exclusions"])

    for row in body["decompositionDaily"]:
        assert row["swapMtm"] is None and row["swapCarry"] is None
        assert math.isclose(
            row["fundingCost"] + row["bondMtm"] + row["bondCarry"], row["total"], abs_tol=1e-6
        )
