"""DV01-FIX Phase A pins — the single bond-DV01 derivation point.

[CHANGED, DV01-A] context: real-data panel values move (bond grand total
x0.678 at 07-14; full old→new ledger in DV01_FIX_REPORT.md). The SUITE's
synthetic fixtures did not move — they carry no static params, which is the
sheet_fallback path by design, pinned here explicitly.
"""
from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.services import bond_risk
from irs_pricer.services.portfolio_analytics_service import PositionData, build_pvbp_sensitivity
from irs_pricer.core.market_data import MarketSnapshot, RateQuote


FIXED_YIELD = 0.03


@pytest.fixture(autouse=True)
def _flat_curve(monkeypatch):
    """Deterministic credit curve: every lookup returns 3.00%."""
    monkeypatch.setattr(
        bond_risk.credit_curve_service,
        "market_yield_for",
        lambda sector, rating, years, d: FIXED_YIELD,
    )


def _kwargs(**over):
    base = dict(
        name="TESTBOND",
        sector="공사채",
        rating="AAA",
        valuation_date=date(2026, 7, 14),
        sheet_pvbp=1_000_000.0,
        stale_bucket="4Y",
        maturity_date=date(2029, 6, 14),
        coupon_rate=3.0,
        payment_frequency=4,
        notional=10_000_000_000.0,
        issue_date=date(2024, 7, 14),
    )
    base.update(over)
    return base


def test_reval_path_returns_positive_dv01_with_fresh_bucket():
    res = bond_risk.bond_dv01(**_kwargs())
    assert res.source == "reval"
    # 3y bond at 3%: DV01 per 1bp on 100억 ≈ ₩2.8M — sanity band, not a pin.
    assert 1_000_000 < res.dv01 < 5_000_000
    assert res.bucket == "3Y"  # FRESH remaining maturity (~2.92y), never the stale sheet bucket


def test_frn_carve_out_keeps_sheet_value_and_marks_source():
    res = bond_risk.bond_dv01(**_kwargs(name="중소기업은행(변) 2603이1A-06"))
    assert res.source == "sheet_frn"
    assert res.dv01 == 1_000_000.0  # sheet figure verbatim — reset-linked duration


def test_missing_static_params_fall_back_to_sheet_and_stale_bucket():
    res = bond_risk.bond_dv01(**_kwargs(coupon_rate=None))
    assert res.source == "sheet_fallback"
    assert res.dv01 == 1_000_000.0
    assert res.bucket == "4Y"  # stale sheet bucket kept — nothing fresher exists


def test_curve_failure_falls_back_not_raises(monkeypatch):
    def boom(sector, rating, years, d):
        raise ValueError("커브 없음")

    monkeypatch.setattr(bond_risk.credit_curve_service, "market_yield_for", boom)
    res = bond_risk.bond_dv01(**_kwargs())
    assert res.source == "sheet_fallback"
    assert res.dv01 == 1_000_000.0


def test_synthetic_issue_path_matches_true_issue_within_tolerance():
    """The simulate wire lacks 발행일자 — the maturity-anchored synthetic
    schedule must reproduce the true-issue DV01 closely (regular bond, no
    stub): the shared derivation is one function, two anchor modes."""
    with_issue = bond_risk.bond_dv01(**_kwargs())
    without = bond_risk.bond_dv01(**_kwargs(issue_date=None))
    assert without.source == "reval"
    assert abs(without.dv01 - with_issue.dv01) / with_issue.dv01 < 0.02


def test_refresh_independence_reval_ignores_sheet_columns():
    """Owner-mandated pin: a refreshed blotter export (different sheet pvbp /
    잔존일수-derived metadata) must NOT change reval-DV01 outputs — the reval
    path reads only the static schedule + curve."""
    stale = bond_risk.bond_dv01(**_kwargs(sheet_pvbp=9_999_999.0, stale_bucket="9M"))
    fresh = bond_risk.bond_dv01(**_kwargs(sheet_pvbp=123.0, stale_bucket="3Y"))
    assert stale.source == fresh.source == "reval"
    assert stale.dv01 == fresh.dv01
    assert stale.bucket == fresh.bucket == "3Y"


def test_detect_blotter_as_of_stale_fresh_and_empty():
    d = date(2026, 7, 14)
    stale_rows = [(date(2027, 1, 1), (date(2027, 1, 1) - date(2026, 3, 23)).days),
                  (date(2028, 6, 1), (date(2028, 6, 1) - date(2026, 3, 23)).days)]
    assert bond_risk.detect_blotter_as_of(stale_rows) == date(2026, 3, 23)
    fresh_rows = [(date(2027, 1, 1), (date(2027, 1, 1) - d).days)]
    assert bond_risk.detect_blotter_as_of(fresh_rows) == d  # fresh export → as-of ≈ today, no drama
    assert bond_risk.detect_blotter_as_of([]) is None
    assert bond_risk.detect_blotter_as_of([(None, 100), (date(2027, 1, 1), 0)]) is None


def _snapshot(d=date(2026, 7, 14)):
    return MarketSnapshot(
        valuation_date=d, cd_rate=0.029, on_rate=None,
        swap_quotes=[RateQuote(tenor_years=t, rate=0.03) for t in (1, 2, 3, 5, 10)],
    )


def _bond(**over):
    base = dict(
        instrument_type="bond", position_id="B1", sector="공사채", book="RP Fund",
        notional=10_000_000_000.0, evaluation_amount=10_000_000_000.0,
        remaining_days=1066 + 113,  # stale by the diagnosis fingerprint (+113d)
        tenor_bucket="4Y", pvbp=4_000_000.0,
        maturity_date=date(2029, 6, 14), issue_date=date(2024, 7, 14),
        coupon_rate=3.0, payment_frequency=4, rating="AAA",
    )
    base.update(over)
    return PositionData(**base)


def test_service_reval_lands_in_fresh_bucket_with_sources_and_as_of():
    rows = build_pvbp_sensitivity([_bond()], _snapshot(), {})
    sector = next(r for r in rows if r["sector"] == "공사채")
    total = next(r for r in rows if r["sector"] == "합계")
    # [CHANGED, DV01-A]: the cell moved from the stale sheet bucket (4Y,
    # workbook 4.0M) to the FRESH 3Y bucket at the reval figure.
    assert sector["4Y"] == 0.0
    assert sector["3Y"] > 0
    assert sector["3Y"] != 4_000_000.0
    assert sector["dv01_sources"] == {"reval": 1}
    assert total["dv01_sources"] == {"reval": 1}
    # as-of detected from the +113d fingerprint on the single row.
    assert total["blotter_as_of"] == "2026-03-23"
    assert "frn_positions" not in total


def test_service_frn_row_enumerated_and_kept_verbatim():
    frn = _bond(position_id="중소기업은행(변) X", pvbp=250_000.0, tenor_bucket="1D", remaining_days=250)
    rows = build_pvbp_sensitivity([frn], _snapshot(), {})
    total = rows[-1]
    assert total["dv01_sources"] == {"sheet_frn": 1}
    assert total["frn_positions"] == ["중소기업은행(변) X"]
    sector = next(r for r in rows if r["sector"] == "공사채")
    # Sheet value kept verbatim, FRESH bucket (maturity known): 3.0y → 3Y.
    assert sector["3Y"] == 250_000.0


def test_service_fixtures_without_static_params_stay_byte_identical():
    """Pins WHY the pre-existing suite didn't move: a bond with no static
    params takes sheet_fallback — same cell, same value as pre-fix."""
    legacy = _bond(issue_date=None, coupon_rate=None, payment_frequency=None,
                   maturity_date=None)
    rows = build_pvbp_sensitivity([legacy], _snapshot(), {})
    sector = next(r for r in rows if r["sector"] == "공사채")
    assert sector["4Y"] == 4_000_000.0  # the old code path's exact cell
    assert sector["dv01_sources"] == {"sheet_fallback": 1}
