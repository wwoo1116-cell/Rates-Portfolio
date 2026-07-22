"""Allocation-history service: anchor resolution and share construction.

Market yields are stubbed so these stay deterministic and file-free -- the
Credit Matrix lookup has its own coverage. value_bond runs for real, since the
whole point of the per-date revaluation is that npv/pvbp actually move.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.services import allocation_history_service as ahs


def _bond(pid="B1", sector="시은채", rating="AA", issue=date(2020, 1, 10),
          maturity=date(2030, 1, 10), coupon=3.0, freq=4, notional=1e9, book="RP Fund"):
    return ahs.BondSnapshotInput(
        position_id=pid, book=book, sector=sector, rating=rating,
        issue_date=issue, maturity_date=maturity, coupon_rate=coupon,
        payment_frequency=freq, notional=notional,
    )


@pytest.fixture
def stub_market(monkeypatch):
    """Business dates for 2025-12-29..2026-07-06 (weekdays only), and a yield
    curve that rises with remaining maturity so roll-down actually shows up."""
    start, end = date(2025, 1, 1), date(2026, 7, 6)
    days = (end - start).days
    available = [
        d for d in (date.fromordinal(start.toordinal() + i) for i in range(days + 1))
        if d.weekday() < 5
    ]
    monkeypatch.setattr(ahs.market_data_service, "list_available_dates", lambda: available)

    def fake_yield(sector, rating, remaining_years, val_date=None):
        if sector == "기타":
            raise ValueError(f"신용 커브를 찾을 수 없습니다: {sector} / {rating}")
        return 0.03 + 0.001 * remaining_years

    monkeypatch.setattr(ahs.credit_curve_service, "market_yield_for", fake_yield)
    return available


# ── anchor resolution ────────────────────────────────────────────────────────

def _anchors(as_of, available):
    return {k: d for k, _label, d in ahs.resolve_anchors(as_of, available)}


def test_anchors_on_a_midweek_day(stub_market):
    # Wed 2026-07-01
    a = _anchors(date(2026, 7, 1), stub_market)
    assert a["current"] == date(2026, 7, 1)
    assert a["prevDay"] == date(2026, 6, 30)
    assert a["lastWeekEnd"] == date(2026, 6, 26)    # previous Friday
    assert a["lastMonthEnd"] == date(2026, 6, 30)
    assert a["lastYearEnd"] == date(2025, 12, 31)


def test_monday_collapses_prev_day_onto_last_week_end(stub_market):
    """Mon 2026-07-06: 'yesterday' and 'last day of last week' are the same
    Friday. Both columns are kept -- the x-axis must stay at five bars whose
    labels mean the same thing every day."""
    a = _anchors(date(2026, 7, 6), stub_market)
    assert a["prevDay"] == date(2026, 7, 3)
    assert a["lastWeekEnd"] == date(2026, 7, 3)
    assert len(ahs.resolve_anchors(date(2026, 7, 6), stub_market)) == 5


def test_early_january_collapses_last_month_end_onto_last_year_end(stub_market):
    # Fri 2026-01-02: last month-end and last year-end are both 2025-12-31.
    a = _anchors(date(2026, 1, 2), stub_market)
    assert a["lastMonthEnd"] == date(2025, 12, 31)
    assert a["lastYearEnd"] == date(2025, 12, 31)
    assert a["prevDay"] == date(2026, 1, 1)


def test_anchor_older_than_all_data_resolves_to_none():
    available = [date(2026, 7, 2), date(2026, 7, 3), date(2026, 7, 6)]
    a = _anchors(date(2026, 7, 6), available)
    assert a["lastYearEnd"] is None
    assert a["lastMonthEnd"] is None
    assert a["current"] == date(2026, 7, 6)


def test_anchors_snap_backwards_over_a_holiday():
    """The anchor is a calendar target, not a trading day: it must walk back to
    the newest date the market data actually has."""
    available = [date(2025, 12, 24), date(2026, 6, 29), date(2026, 7, 6)]
    a = _anchors(date(2026, 7, 6), available)
    assert a["lastYearEnd"] == date(2025, 12, 24)   # not 12-31; no data that day
    assert a["lastMonthEnd"] == date(2026, 6, 29)   # not 06-30


# ── share construction ───────────────────────────────────────────────────────

def _rows(block):
    return {r["key"]: r for r in block["rows"]}


def test_shares_sum_to_100_in_every_column(stub_market):
    positions = [
        _bond("A", sector="시은채", maturity=date(2026, 9, 1)),
        _bond("B", sector="공사채", maturity=date(2028, 3, 1)),
        _bond("C", sector="여전채", maturity=date(2031, 3, 1)),
    ]
    out = ahs.build_allocation_history(positions, book="RP Fund")
    for name in ("sector", "maturity"):
        block = out[name]
        for row in block["rows"]:
            total = sum(row[k] for k in block["keys"])
            assert total == pytest.approx(100.0, abs=1e-6), f"{name}/{row['key']} = {total}"


def test_maturity_buckets_roll_down_over_time(stub_market):
    """A bond maturing 2027-03 is 중기 at last year-end (1.2y out) but 단기 by
    the current column (0.7y out). If this comes back flat, remaining maturity
    is being measured at today rather than at each column's own date."""
    out = ahs.build_allocation_history([_bond("A", maturity=date(2027, 3, 1))],
                                       as_of_date=date(2026, 7, 6))
    rows = _rows(out["maturity"])
    assert rows["lastYearEnd"][ahs.BUCKET_MID] == pytest.approx(100.0)
    assert rows["current"][ahs.BUCKET_SHORT] == pytest.approx(100.0)


def test_bond_not_yet_issued_is_excluded_from_older_columns(stub_market):
    """value_bond would otherwise discount the full schedule and return a
    confident price for a holding that did not exist."""
    positions = [
        _bond("OLD", sector="시은채", issue=date(2024, 1, 1), maturity=date(2029, 1, 1)),
        _bond("NEW", sector="공사채", issue=date(2026, 3, 1), maturity=date(2029, 1, 1)),
    ]
    out = ahs.build_allocation_history(positions, as_of_date=date(2026, 7, 6))
    rows = _rows(out["sector"])

    assert rows["lastYearEnd"]["positionCount"] == 1      # NEW didn't exist yet
    assert rows["lastYearEnd"]["공사채"] == 0.0
    assert rows["lastYearEnd"]["시은채"] == pytest.approx(100.0)

    assert rows["current"]["positionCount"] == 2
    assert rows["current"]["공사채"] > 0.0


def test_matured_bond_drops_out_of_columns_that_postdate_it(stub_market):
    """An uploaded blotter can lag the newest market data, so holdings that have
    since matured are still in the file."""
    positions = [
        _bond("ALIVE", sector="시은채", maturity=date(2029, 1, 1)),
        _bond("GONE", sector="공사채", maturity=date(2026, 2, 1)),
    ]
    out = ahs.build_allocation_history(positions, as_of_date=date(2026, 7, 6))
    rows = _rows(out["sector"])
    assert rows["lastYearEnd"]["positionCount"] == 2       # both alive in Dec 2025
    assert rows["current"]["positionCount"] == 1           # GONE matured in Feb
    assert rows["current"]["공사채"] == 0.0


def test_unpriceable_bond_is_reported_not_fatal(stub_market):
    """loaders/portfolio.py maps anything it can't classify to the 기타
    catch-all, which has no credit curve. That must not 500 the panel."""
    positions = [_bond("OK", sector="시은채"), _bond("BAD", sector="기타")]
    out = ahs.build_allocation_history(positions, as_of_date=date(2026, 7, 6))
    assert out["unpriceablePositions"] == 1
    assert out["totalPositions"] == 2
    assert "기타" not in out["sector"]["keys"]
    assert _rows(out["sector"])["current"]["시은채"] == pytest.approx(100.0)


def test_unresolved_anchor_yields_an_empty_column(monkeypatch, stub_market):
    monkeypatch.setattr(ahs.market_data_service, "list_available_dates",
                        lambda: [date(2026, 7, 2), date(2026, 7, 3), date(2026, 7, 6)])
    out = ahs.build_allocation_history([_bond("A")], as_of_date=date(2026, 7, 6))
    rows = _rows(out["sector"])
    assert rows["lastYearEnd"]["valuationDate"] is None
    assert rows["lastYearEnd"]["positionCount"] == 0
    assert all(rows["lastYearEnd"][k] == 0.0 for k in out["sector"]["keys"])
    assert rows["current"]["시은채"] == pytest.approx(100.0)


def test_series_order_is_stable_and_led_by_the_current_column(stub_market):
    """Stack order and colours must not reshuffle between columns, so keys are
    ordered by the current column's share, descending."""
    positions = [
        _bond("A", sector="시은채", notional=5e9, maturity=date(2029, 1, 1)),
        _bond("B", sector="공사채", notional=1e9, maturity=date(2029, 1, 1)),
        _bond("C", sector="여전채", notional=3e9, maturity=date(2029, 1, 1)),
    ]
    out = ahs.build_allocation_history(positions, as_of_date=date(2026, 7, 6))
    keys = out["sector"]["keys"]
    assert keys == ["시은채", "여전채", "공사채"]
    current = _rows(out["sector"])["current"]
    shares = [current[k] for k in keys]
    assert shares == sorted(shares, reverse=True)


def test_book_filter_selects_only_that_book(stub_market):
    positions = [
        _bond("A", sector="시은채", book="RP Fund"),
        _bond("B", sector="공사채", book="Other Book"),
    ]
    out = ahs.build_allocation_history(positions, book="RP Fund",
                                       as_of_date=date(2026, 7, 6))
    assert out["totalPositions"] == 1
    assert out["sector"]["keys"] == ["시은채"]


def test_maturity_keys_follow_the_canonical_bucket_order(stub_market):
    positions = [
        _bond("S", sector="시은채", maturity=date(2026, 9, 1)),
        _bond("L", sector="공사채", maturity=date(2032, 1, 1)),
    ]
    out = ahs.build_allocation_history(positions, as_of_date=date(2026, 7, 6))
    keys = out["maturity"]["keys"]
    assert keys == [k for k in ahs.MATURITY_BUCKETS if k in keys]
