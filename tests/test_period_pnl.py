"""Period PnL (WTD/MTD/YTD): baseline resolution, blank-not-zero policy, and
the telescoping reconciliation identity.

Market yields are stubbed (deterministic, file-free) exactly as in
test_allocation_history_service.py; value_bond runs for real because the whole
point is that the two legs of each figure are genuine revaluations.

The KR holiday calendar enters through `list_available_dates`: market data has
no row on a holiday, so an anchor landing on one must snap back to the prior
business day. The tests below build that calendar explicitly (weekdays minus a
named KRX holiday) rather than mocking resolve_anchors -- the resolution path
under test is the same one the allocation charts use.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from irs_pricer.services import allocation_history_service as ahs
from irs_pricer.services import portfolio_analytics_service as pas


def _bond(pid="B1", sector="시은채", rating="AA", issue=date(2020, 1, 10),
          maturity=date(2030, 1, 10), coupon=3.0, freq=4, notional=1e9, book="RP Fund"):
    return ahs.BondSnapshotInput(
        position_id=pid, book=book, sector=sector, rating=rating,
        issue_date=issue, maturity_date=maturity, coupon_rate=coupon,
        payment_frequency=freq, notional=notional,
    )


def _weekdays(start: date, end: date, holidays: set[date] = frozenset()) -> list[date]:
    days = (end - start).days
    return [
        d for d in (date.fromordinal(start.toordinal() + i) for i in range(days + 1))
        if d.weekday() < 5 and d not in holidays
    ]


def _stub(monkeypatch, available: list[date]):
    monkeypatch.setattr(ahs.market_data_service, "list_available_dates", lambda: available)

    def fake_yield(sector, rating, remaining_years, val_date=None):
        if sector == "기타":
            raise ValueError(f"신용 커브를 찾을 수 없습니다: {sector} / {rating}")
        # Rises with maturity AND drifts with the valuation date so both
        # roll-down and a genuine market move show up in the figures.
        drift = 0.0001 * ((val_date - date(2025, 1, 1)).days if val_date else 0) / 365.0
        return 0.03 + 0.001 * remaining_years + drift

    monkeypatch.setattr(ahs.credit_curve_service, "market_yield_for", fake_yield)


def _row(out: dict, book: str) -> dict:
    return next(r for r in out["rows"] if r["book"] == book)


# ── baseline resolution (same KR business-day calendar as allocation-history) ─

def test_weekend_month_end_resolves_to_prior_friday(monkeypatch):
    """Nominal month-end 2026-05-31 is a Sunday; the MTD baseline must be
    Friday 2026-05-29, the prior business day."""
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 6, 15)))
    out = pas.build_period_pnl([_bond()], as_of_date=date(2026, 6, 15))
    assert _row(out, "Total")["mtd"]["baseline_date"] == "2026-05-29"


def test_holiday_friday_resolves_week_end_to_thursday(monkeypatch):
    """2026-10-09 (한글날) falls on a Friday. For Monday 2026-10-12 the WTD
    baseline is nominally 'last Friday', but there is no market data on the
    holiday -- it must resolve to Thursday 2026-10-08."""
    _stub(monkeypatch, _weekdays(date(2026, 9, 1), date(2026, 10, 12),
                                 holidays={date(2026, 10, 9)}))
    out = pas.build_period_pnl([_bond()], as_of_date=date(2026, 10, 12))
    assert _row(out, "Total")["wtd"]["baseline_date"] == "2026-10-08"


def test_year_end_holiday_resolves_to_last_trading_day(monkeypatch):
    """KRX has no session on Dec 31; the YTD baseline must fall back to the
    last day the market data actually has (Dec 30)."""
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 7, 15),
                                 holidays={date(2025, 12, 31), date(2026, 1, 1)}))
    out = pas.build_period_pnl([_bond()], as_of_date=date(2026, 7, 15))
    assert _row(out, "Total")["ytd"]["baseline_date"] == "2025-12-30"


def test_baselines_match_allocation_history_anchors_exactly(monkeypatch):
    """One date-resolution path, not two: the figures' baseline dates must be
    exactly the allocation charts' lastWeekEnd/lastMonthEnd/lastYearEnd."""
    available = _weekdays(date(2025, 12, 1), date(2026, 7, 15))
    _stub(monkeypatch, available)
    as_of = date(2026, 7, 15)
    anchors = {k: d for k, _l, d in ahs.resolve_anchors(as_of, available)}
    out = pas.build_period_pnl([_bond()], as_of_date=as_of)
    total = _row(out, "Total")
    assert total["wtd"]["baseline_date"] == anchors["lastWeekEnd"].isoformat()
    assert total["mtd"]["baseline_date"] == anchors["lastMonthEnd"].isoformat()
    assert total["ytd"]["baseline_date"] == anchors["lastYearEnd"].isoformat()


# ── blank-not-zero ────────────────────────────────────────────────────────────

def test_baseline_before_all_data_is_blank_not_zero(monkeypatch):
    """A YTD anchor older than every market-data row has no baseline: the
    figure must be null-with-null-date, never 0."""
    _stub(monkeypatch, _weekdays(date(2026, 7, 1), date(2026, 7, 15)))
    out = pas.build_period_pnl([_bond()], as_of_date=date(2026, 7, 15))
    ytd = _row(out, "Total")["ytd"]
    assert ytd["baseline_date"] is None
    assert ytd["pnl"] is None
    assert ytd["complete"] is False


def test_unpriceable_bond_is_excluded_not_zero_filled(monkeypatch):
    """A 기타-sector bond has no credit curve. The figure must aggregate over
    the priceable bond only, disclose the exclusion, and mark itself partial --
    zero-filling the missing leg would fabricate a 0 PnL for it."""
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 7, 15)))
    ok, bad = _bond("OK"), _bond("BAD", sector="기타")
    both = pas.build_period_pnl([ok, bad], as_of_date=date(2026, 7, 15))
    alone = pas.build_period_pnl([ok], as_of_date=date(2026, 7, 15))

    wtd_both, wtd_alone = _row(both, "Total")["wtd"], _row(alone, "Total")["wtd"]
    assert wtd_both["included_positions"] == 1
    assert wtd_both["excluded_unpriceable"] == 1
    assert wtd_both["complete"] is False
    assert wtd_both["pnl"] == pytest.approx(wtd_alone["pnl"])  # OK bond only


def test_all_bonds_unpriceable_yields_null_not_zero(monkeypatch):
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 7, 15)))
    out = pas.build_period_pnl([_bond("BAD", sector="기타")], as_of_date=date(2026, 7, 15))
    wtd = _row(out, "Total")["wtd"]
    assert wtd["pnl"] is None
    assert wtd["included_positions"] == 0
    assert wtd["complete"] is False


def test_bond_issued_mid_period_is_an_expected_exclusion(monkeypatch):
    """Issued after the YTD baseline: under 'current book revalued at past
    dates' it has no year-start value. It drops out of YTD as not_held (the
    figure stays complete -- this is methodology, not missing data) but counts
    in WTD, whose baseline it predates."""
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 7, 15)))
    old = _bond("OLD", issue=date(2024, 1, 1))
    new = _bond("NEW", issue=date(2026, 3, 2), maturity=date(2029, 3, 2))
    out = pas.build_period_pnl([old, new], as_of_date=date(2026, 7, 15))
    total = _row(out, "Total")
    assert total["ytd"]["included_positions"] == 1
    assert total["ytd"]["excluded_not_held"] == 1
    assert total["ytd"]["complete"] is True
    assert total["wtd"]["included_positions"] == 2
    assert total["wtd"]["excluded_not_held"] == 0


# ── aggregation shape ─────────────────────────────────────────────────────────

def test_per_book_rows_plus_total(monkeypatch):
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 7, 15)))
    positions = [
        _bond("A", book="RP Fund"),
        _bond("B", book="Prop", sector="공사채", maturity=date(2028, 6, 1)),
    ]
    out = pas.build_period_pnl(positions, as_of_date=date(2026, 7, 15))
    assert [r["book"] for r in out["rows"]] == ["Prop", "RP Fund", "Total"]
    wtd = {r["book"]: r["wtd"] for r in out["rows"]}
    # Total is a direct aggregate over all bonds; with both books fully
    # populated it must equal the sum of the book figures.
    assert wtd["Total"]["pnl"] == pytest.approx(wtd["RP Fund"]["pnl"] + wtd["Prop"]["pnl"])
    assert wtd["Total"]["included_positions"] == 2


def test_book_filter(monkeypatch):
    _stub(monkeypatch, _weekdays(date(2025, 12, 1), date(2026, 7, 15)))
    positions = [_bond("A", book="RP Fund"), _bond("B", book="Prop")]
    out = pas.build_period_pnl(positions, book="RP Fund", as_of_date=date(2026, 7, 15))
    assert [r["book"] for r in out["rows"]] == ["RP Fund", "Total"]
    assert _row(out, "Total")["wtd"]["included_positions"] == 1


# ── reconciliation identity ──────────────────────────────────────────────────

def test_wtd_reconciles_with_sum_of_daily_revaluation_changes(monkeypatch):
    """The consistency check: WTD PnL vs last Friday's close must equal the sum
    of daily revaluation changes since then. This telescopes only if both
    legs of every figure come from the same revaluation machinery -- which is
    exactly why build_period_pnl prices its current leg with revalue_bond
    instead of trusting the workbook's 평가금액 column.

        WTD = V(7/15) - V(7/10)
            = [V(7/13)-V(7/10)] + [V(7/14)-V(7/13)] + [V(7/15)-V(7/14)]
    """
    available = _weekdays(date(2025, 12, 1), date(2026, 7, 15))
    _stub(monkeypatch, available)
    positions = [
        _bond("A", sector="시은채", maturity=date(2027, 9, 1)),
        _bond("B", sector="공사채", maturity=date(2029, 3, 1), coupon=4.25, notional=3e9),
    ]
    as_of = date(2026, 7, 15)
    out = pas.build_period_pnl(positions, as_of_date=as_of)
    wtd = _row(out, "Total")["wtd"]
    assert wtd["baseline_date"] == "2026-07-10"  # Wed 7/15 -> previous Friday

    def v(d: date) -> float:
        return sum(ahs.revalue_bond(b, d)[0] for b in positions)

    days = [d for d in available if date(2026, 7, 10) <= d <= as_of]
    assert days == [date(2026, 7, 10), date(2026, 7, 13), date(2026, 7, 14), date(2026, 7, 15)]
    daily_changes = [v(b) - v(a) for a, b in zip(days, days[1:])]

    # "To displayed precision" is 0.1M KRW on screen; the identity is in fact
    # exact up to float addition order, so assert far tighter than the display.
    assert wtd["pnl"] == pytest.approx(sum(daily_changes), abs=1e-4)
    # And the direct two-endpoint difference agrees too.
    assert wtd["pnl"] == pytest.approx(v(as_of) - v(date(2026, 7, 10)), abs=1e-4)
