"""
Coverage for portfolio_analytics_service -- the three Home dashboard panels
(PVBP sensitivity / daily PnL by book / book summary), which had none.

Focus is the shared-delta cache and the assumptions its key depends on, since
that cache is what collapses three identical repricings per dashboard load
into one.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.core import ttl_cache
from irs_pricer.core.market_data import MarketSnapshot, RateQuote
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services import portfolio_service
from irs_pricer.services.portfolio_analytics_service import PositionData

_VALUATION_DATE = date(2026, 6, 29)


def _snapshot(cd_rate: float = 0.0330) -> MarketSnapshot:
    quotes = [
        RateQuote(1, 0.0328, tenor_months=6),
        RateQuote(1, 0.0310),
        RateQuote(2, 0.0305),
        RateQuote(3, 0.0302),
        RateQuote(5, 0.0305),
        RateQuote(10, 0.0325),
    ]
    return MarketSnapshot(valuation_date=_VALUATION_DATE, cd_rate=cd_rate,
                          on_rate=0.0325, swap_quotes=quotes)


def _irs(position_id: str, book: str = "Book A", sector: str = "IRS") -> PositionData:
    return PositionData(
        instrument_type="irs",
        position_id=position_id,
        sector=sector,
        book=book,
        start_date=date(2025, 6, 25),
        maturity_date=date(2030, 6, 25),
        notional=1_000_000_000.0,
        fixed_rate=0.0305,
        pay_fixed=True,
        float_spread=0.0,
    )


def _bond(position_id: str, book: str = "Book A", sector: str = "국고채") -> PositionData:
    """A fully-specified bond -- including the static params blotter-parser.ts
    hydrates. With them the backend can build a coupon schedule and genuinely
    revalue the bond; tests that want the analytic fallback null them out."""
    return PositionData(
        instrument_type="bond",
        position_id=position_id,
        sector=sector,
        book=book,
        notional=1_000_000_000.0,
        evaluation_amount=1_010_000_000.0,
        remaining_days=800,
        tenor_bucket="3Y",
        entry_yield=3.10,
        mtm_yield=3.05,
        duration=2.7,
        pvbp=-270_000.0,
        issue_date=date(2023, 5, 10),
        maturity_date=date(2028, 9, 7),
        coupon_rate=3.125,
        payment_frequency=2,
        rating=None,
    )


@pytest.fixture(autouse=True)
def _clear():
    ttl_cache.clear()
    yield
    ttl_cache.clear()


def test_delta_is_independent_of_fixings():
    """Pins the _shared_delta cache-key contract.

    The key deliberately omits `fixings` because price_portfolio_delta prices
    sensitivities off the curve alone and ignores it. If that ever stops being
    true, the key becomes wrong -- two different fixing sets would collide on
    one cached delta -- and this test is what says so.
    """
    snapshot = _snapshot()
    swaps = [pas._to_swap(_irs("P1"))]

    a = portfolio_service.price_portfolio_delta(snapshot, swaps, {})
    b = portfolio_service.price_portfolio_delta(
        snapshot, swaps, {date(2026, 6, 26): 0.99, date(2026, 6, 25): 0.01}
    )
    assert a.total_delta == b.total_delta, (
        "price_portfolio_delta now depends on fixings -- _shared_delta's cache "
        "key must include a fixings fingerprint"
    )


def test_shared_delta_is_computed_once_across_the_three_panels(monkeypatch):
    """The dashboard fires all three panels at one snapshot+portfolio. The
    expensive delta must be priced once, not three times."""
    calls = {"n": 0}
    real = portfolio_service.price_portfolio_delta

    def counting(snapshot, swaps, fixings):
        calls["n"] += 1
        return real(snapshot, swaps, fixings)

    monkeypatch.setattr(portfolio_service, "price_portfolio_delta", counting)

    positions = [_irs("P1"), _irs("P2"), _bond("B1")]
    snapshot = _snapshot()

    pas.build_pvbp_sensitivity(positions, snapshot, {})
    pas.build_book_summary(positions, snapshot, {})
    assert calls["n"] == 1, f"delta repriced {calls['n']}x for one dashboard load"


def test_shared_delta_reprices_when_the_curve_moves(monkeypatch):
    """The flip side: the cache is content-addressed, so a moved quote must
    miss rather than serve yesterday's risk."""
    calls = {"n": 0}
    real = portfolio_service.price_portfolio_delta

    def counting(snapshot, swaps, fixings):
        calls["n"] += 1
        return real(snapshot, swaps, fixings)

    monkeypatch.setattr(portfolio_service, "price_portfolio_delta", counting)

    positions = [_irs("P1")]
    pas.build_pvbp_sensitivity(positions, _snapshot(cd_rate=0.0330), {})
    pas.build_pvbp_sensitivity(positions, _snapshot(cd_rate=0.0331), {})
    assert calls["n"] == 2, "a 1bp CD move must invalidate the cached delta"


def test_shared_delta_reprices_when_a_position_changes(monkeypatch):
    calls = {"n": 0}
    real = portfolio_service.price_portfolio_delta

    def counting(snapshot, swaps, fixings):
        calls["n"] += 1
        return real(snapshot, swaps, fixings)

    monkeypatch.setattr(portfolio_service, "price_portfolio_delta", counting)

    snapshot = _snapshot()
    pas.build_pvbp_sensitivity([_irs("P1")], snapshot, {})

    bigger = _irs("P1")
    bigger.notional = 2_000_000_000.0
    pas.build_pvbp_sensitivity([bigger], snapshot, {})
    assert calls["n"] == 2, "resizing a position must invalidate the cached delta"


def test_pvbp_sensitivity_totals_reconcile():
    positions = [_irs("P1"), _bond("B1")]
    rows = pas.build_pvbp_sensitivity(positions, _snapshot(), {})

    total_row = [r for r in rows if r["sector"] == "합계"]
    assert len(total_row) == 1
    sector_rows = [r for r in rows if r["sector"] != "합계"]
    assert total_row[0]["total"] == pytest.approx(sum(r["total"] for r in sector_rows))


def test_book_summary_needs_no_daily_pnl_argument():
    """build_book_summary used to take a daily_pnl_by_book it never read, which
    forced the frontend to await /book-daily-pnl before it could even ask for
    this panel. It's a two-argument call now; the panels are independent."""
    rows = pas.build_book_summary([_irs("P1"), _bond("B1")], _snapshot(), {})
    assert [r["book"] for r in rows] == ["Book A"]
    assert rows[0]["totalEvaluationAmount"] == pytest.approx(1_010_000_000.0)


def test_book_summary_hedged_duration_nets_irs_against_bonds():
    """A receive-fixed swap should offset a bond's negative PVBP, so net
    hedged duration must sit below the bond-only figure."""
    bond_only = pas.build_book_summary([_bond("B1")], _snapshot(), {})[0]

    receiver = _irs("P1")
    receiver.pay_fixed = False
    hedged = pas.build_book_summary([_bond("B1"), receiver], _snapshot(), {})[0]

    assert hedged["hedgedDuration"] > bond_only["hedgedDuration"]


# ---------------------------------------------------------------------------
# A1/A2: daily PnL decomposed as ΔNPV = MtM + Theta
# ---------------------------------------------------------------------------

def _pin_quotes(monkeypatch, today_snapshot):
    """Control whether T has quotes.

    build_book_daily_pnl resolves T itself and asks market_data_service whether
    it has quotes for it. Left alone, these tests would depend on whatever the
    real workbooks happen to hold for the day after _VALUATION_DATE -- so pin it.
    """
    monkeypatch.setattr(pas, "_snapshot_or_none", lambda _d: today_snapshot)


def test_as_of_is_the_next_business_day_after_the_close(monkeypatch):
    """T is derived, not passed in: the caller sends the close and the server
    rolls it forward. 2026-06-29 is a Monday, so T is Tuesday the 30th."""
    _pin_quotes(monkeypatch, None)
    res = pas.build_book_daily_pnl([_irs("P1")], _snapshot(), {})
    assert res["as_of"] == "2026-06-30"


def test_as_of_skips_the_weekend(monkeypatch):
    """A Friday close rolls to Monday, not Saturday -- theta is one BUSINESS
    day. (The carry/funding legs still accrue the real 3 calendar days.)"""
    _pin_quotes(monkeypatch, None)
    friday = MarketSnapshot(valuation_date=date(2026, 7, 3), cd_rate=0.033,
                            on_rate=0.0325, swap_quotes=_snapshot().swap_quotes)
    res = pas.build_book_daily_pnl([_irs("P1")], friday, {})
    assert res["as_of"] == "2026-07-06"


def test_premarket_mtm_is_exactly_zero_for_every_instrument(monkeypatch):
    """A2's core requirement. Not approximately zero -- exactly, because with no
    quotes for T the MtM leg prices against the very same curve as the theta
    leg, so the two valuations are bit-identical."""
    _pin_quotes(monkeypatch, None)
    res = pas.build_book_daily_pnl([_irs("P1"), _irs("P2"), _bond("B1")], _snapshot(), {})

    assert res["quotes_available"] is False
    assert res["daily_pnl"]["mtm"] == 0.0
    for row in res["by_book"]:
        assert row["mtm"] == 0.0
    for inst in res["by_instrument"]:
        assert inst["mtm"] == 0.0, f"{inst['id']} has non-zero MtM before the open"


def test_premarket_theta_is_already_reflected(monkeypatch):
    """The other half of A2: theta is known deterministically at T's open, so it
    must NOT be zero just because quotes haven't arrived."""
    _pin_quotes(monkeypatch, None)
    res = pas.build_book_daily_pnl([_irs("P1"), _bond("B1")], _snapshot(), {})
    assert res["daily_pnl"]["theta"] != 0.0


def test_total_equals_mtm_plus_theta_exactly(monkeypatch):
    """The no-residual-bucket requirement, at every level of aggregation.

    Exact equality, not approx: the spec forbids a residual and the
    decomposition telescopes, so drift here is a real defect, not float noise.
    """
    _pin_quotes(monkeypatch, _snapshot(cd_rate=0.0335))
    res = pas.build_book_daily_pnl([_irs("P1"), _irs("P2"), _bond("B1")], _snapshot(), {})

    dp = res["daily_pnl"]
    assert dp["total"] == dp["mtm"] + dp["theta"]
    for row in res["by_book"]:
        assert row["total"] == row["mtm"] + row["theta"]
    for inst in res["by_instrument"]:
        assert inst["total"] == inst["mtm"] + inst["theta"]


def test_swap_total_matches_an_independent_revaluation(monkeypatch):
    """Pins the claim that the decomposition only re-splits the total, never
    moves it: mtm + theta must equal V(T, c_T) - V(close, c_close) computed
    straight from price_portfolio, with no reference to the split at all."""
    close = _snapshot()
    today = _snapshot(cd_rate=0.0340)
    _pin_quotes(monkeypatch, today)

    irs = [_irs("P1"), _irs("P2")]
    res = pas.build_book_daily_pnl(irs, close, {})

    swaps = [pas._to_swap(p) for p in irs]
    rolled_today = MarketSnapshot(
        valuation_date=date.fromisoformat(res["as_of"]), cd_rate=today.cd_rate,
        on_rate=today.on_rate, swap_quotes=today.swap_quotes,
    )
    v_close = portfolio_service.price_portfolio(close, swaps, {}).net_npv
    v_today = portfolio_service.price_portfolio(rolled_today, swaps, {}).net_npv

    assert res["daily_pnl"]["total"] == pytest.approx(v_today - v_close, rel=1e-12)


def test_funding_is_excluded_from_total(monkeypatch):
    """Funding is a financing cost, not a change in NPV. It must be reported but
    must not leak into total, or total stops meaning ΔNPV."""
    _pin_quotes(monkeypatch, None)
    res = pas.build_book_daily_pnl([_bond("B1")], _snapshot(), {}, funding_spread_bp=10.0)
    row = res["by_book"][0]
    assert row["funding"] < 0, "a funded bond position should show a financing cost"
    assert row["total"] == row["mtm"] + row["theta"]


def test_bond_without_static_params_is_kept_not_dropped(monkeypatch):
    """A bond whose blotter row has no issue date can't be scheduled, so it
    can't be revalued -- but it still has carry. Dropping it would silently
    understate the book, so it falls back to an analytic split and is flagged."""
    _pin_quotes(monkeypatch, None)
    bare = _bond("B-NOSTATIC")
    bare.issue_date = None
    bare.coupon_rate = None
    bare.payment_frequency = None

    res = pas.build_book_daily_pnl([bare], _snapshot(), {})
    insts = res["by_instrument"]
    assert len(insts) == 1, "position vanished from the PnL"
    assert insts[0]["theta"] != 0.0, "fallback must still carry"
    assert "degraded_reason" in insts[0], "silent approximation -- must be reported"


def test_bond_with_static_params_is_revalued_not_approximated(monkeypatch):
    """The revaluation path must do more than the analytic carry it replaces:
    rolling the valuation date also rolls the bond down its own curve, which
    eval x ytm/365 cannot see."""
    _pin_quotes(monkeypatch, None)
    full = _bond("B-FULL")
    bare = _bond("B-FULL")
    bare.issue_date = None
    bare.coupon_rate = None
    bare.payment_frequency = None

    revalued = pas.build_book_daily_pnl([full], _snapshot(), {})["by_instrument"][0]
    analytic = pas.build_book_daily_pnl([bare], _snapshot(), {})["by_instrument"][0]

    assert "degraded_reason" not in revalued
    assert revalued["theta"] != analytic["theta"]


def test_duplicate_position_ids_do_not_collapse(monkeypatch):
    """The real blotter holds the same bond in several lots -- one id appears 9x.
    Anything that indexes PnL by position_id silently merges them and loses the
    book. Every lot must survive into by_instrument and into the book total."""
    _pin_quotes(monkeypatch, None)
    lots = [_bond("SAME-ID"), _bond("SAME-ID"), _bond("SAME-ID")]
    res = pas.build_book_daily_pnl(lots, _snapshot(), {})

    assert len(res["by_instrument"]) == 3
    one = pas.build_book_daily_pnl([_bond("SAME-ID")], _snapshot(), {})
    assert res["daily_pnl"]["theta"] == pytest.approx(3 * one["daily_pnl"]["theta"], rel=1e-12)


# ---------------------------------------------------------------------------
# A3: PVBP sector row order
# ---------------------------------------------------------------------------

def test_pvbp_rows_follow_credit_quality_order():
    """Fixed order by credit quality, IRS last, 합계 last -- NOT a name sort.
    A name sort puts IRS first ('IRS' is Latin; every Hangul syllable sorts
    above it) and orders the rest by spelling, which means nothing here."""
    positions = [_bond(f"B-{s}", sector=s) for s in
                 ["회사채", "국고채", "여전채", "통안채", "시은채", "공사채", "특은채"]]
    positions.append(_irs("P1"))

    rows = pas.build_pvbp_sensitivity(positions, _snapshot(), {})
    assert [r["sector"] for r in rows] == [
        "국고채", "통안채", "공사채", "특은채", "시은채", "여전채", "회사채", "IRS", "합계",
    ]


def test_pvbp_absent_sectors_are_skipped_without_breaking_order():
    positions = [_bond("B1", sector="국고채"), _bond("B2", sector="여전채"), _irs("P1")]
    rows = pas.build_pvbp_sensitivity(positions, _snapshot(), {})
    assert [r["sector"] for r in rows] == ["국고채", "여전채", "IRS", "합계"]


def test_pvbp_unknown_sector_slots_after_the_known_ones_and_warns(caplog):
    """loaders/portfolio.py maps an unrecognised sub-class to '기타', so this is a
    real case, not a hypothetical."""
    positions = [_bond("B1", sector="회사채"), _bond("B2", sector="기타"), _irs("P1")]
    with caplog.at_level("WARNING"):
        rows = pas.build_pvbp_sensitivity(positions, _snapshot(), {})

    assert [r["sector"] for r in rows] == ["회사채", "기타", "IRS", "합계"]
    assert any("기타" in str(r.args) for r in caplog.records), "unknown sector must be logged"


def test_pvbp_total_row_is_last_even_with_unknown_sectors():
    positions = [_bond("B1", sector="기타"), _irs("P1")]
    rows = pas.build_pvbp_sensitivity(positions, _snapshot(), {})
    assert rows[-1]["sector"] == "합계"
