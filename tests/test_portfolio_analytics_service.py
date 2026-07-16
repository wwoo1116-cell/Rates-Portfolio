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

_AS_OF = date(2026, 6, 30)  # next business day after _VALUATION_DATE (Mon 6/29)


def _pin_sources(monkeypatch, *, irs: bool, credit: bool, today_snapshot=None):
    """Pin per-source quote availability.

    Availability is per SOURCE, not one global flag: swaps price off the IRS/CD
    snapshot and bonds off the Credit Matrix, and the two genuinely have
    different coverage (measured: Matrix to 2026-07-13, IRS to 2026-07-06).
    Left alone these tests would depend on whatever the real workbooks happen to
    hold for the day after _VALUATION_DATE, so pin both.
    """
    monkeypatch.setattr(pas, "_source_dates", lambda: {
        pas._SOURCE_IRS: [_AS_OF] if irs else [],
        pas._SOURCE_CREDIT: [_AS_OF] if credit else [],
    })
    monkeypatch.setattr(pas, "_snapshot_or_none", lambda _d: today_snapshot)


def test_as_of_is_the_next_business_day_after_the_close(monkeypatch):
    """T is derived, not passed in: the caller sends the close and the server
    rolls it forward. 2026-06-29 is a Monday, so T is Tuesday the 30th."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    res = pas.build_book_daily_pnl([_irs("P1")], _snapshot(), {})
    assert res["as_of"] == "2026-06-30"


def test_as_of_skips_the_weekend(monkeypatch):
    """A Friday close rolls to Monday, not Saturday -- theta is one BUSINESS
    day. (The carry/funding legs still accrue the real 3 calendar days.)"""
    _pin_sources(monkeypatch, irs=False, credit=False)
    friday = MarketSnapshot(valuation_date=date(2026, 7, 3), cd_rate=0.033,
                            on_rate=0.0325, swap_quotes=_snapshot().swap_quotes)
    res = pas.build_book_daily_pnl([_irs("P1")], friday, {})
    assert res["as_of"] == "2026-07-06"



def test_premarket_theta_is_already_reflected(monkeypatch):
    """The other half of A2: theta is known deterministically at T's open, so it
    must NOT be zero just because quotes haven't arrived."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    res = pas.build_book_daily_pnl([_irs("P1"), _bond("B1")], _snapshot(), {})
    assert res["daily_pnl"]["theta"] != 0.0





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


def test_missing_quotes_give_none_not_zero(monkeypatch):
    """A2's core requirement, sharpened: MtM must be blank, never 0.

    0 asserts "quotes arrived and nothing moved" -- a different, false claim.
    On a risk screen the two must not look identical, so absence stays None all
    the way out and renders as an em-dash.
    """
    _pin_sources(monkeypatch, irs=False, credit=False)
    res = pas.build_book_daily_pnl([_irs("P1"), _bond("B1")], _snapshot(), {})

    assert res["daily_pnl"]["mtm"] is None
    assert res["daily_pnl"]["mtm_complete"] is False
    for row in res["by_book"]:
        assert row["mtm"] is None, "unknown MtM must be None, not 0.0"


def test_theta_is_reflected_even_with_no_quotes(monkeypatch):
    """The other half of A2: theta is deterministic and known at T's open, so it
    must NOT be suppressed just because quotes haven't arrived."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    res = pas.build_book_daily_pnl([_irs("P1"), _bond("B1")], _snapshot(), {})
    assert res["daily_pnl"]["theta"] != 0.0
    assert res["daily_pnl"]["total"] == res["daily_pnl"]["theta"]


def test_quote_sources_are_reported_per_source(monkeypatch):
    """The single "market open" flag is gone: the sources have genuinely
    different coverage, so the header has to say which one is behind."""
    _pin_sources(monkeypatch, irs=False, credit=True)
    res = pas.build_book_daily_pnl([_irs("P1")], _snapshot(), {})

    by_name = {s["source"]: s for s in res["quote_sources"]}
    assert by_name[pas._SOURCE_IRS]["has_as_of"] is False
    assert by_name[pas._SOURCE_CREDIT]["has_as_of"] is True
    assert by_name[pas._SOURCE_CREDIT]["latest"] == _AS_OF.isoformat()


def test_mixed_sources_mark_the_book_partial(monkeypatch):
    """The real situation: Credit Matrix has as_of but IRS doesn't, so bonds
    have MtM and swaps don't. The book row must show the bond MtM it does know
    AND flag that it isn't the whole picture -- not silently present a partial
    sum as a complete total."""
    _pin_sources(monkeypatch, irs=False, credit=True)
    res = pas.build_book_daily_pnl([_irs("P1"), _bond("B1")], _snapshot(), {})

    row = res["by_book"][0]
    assert row["mtm"] is not None, "the bond's MtM is known and must be shown"
    assert row["mtm_complete"] is False, "the swap's MtM is missing -- row is partial"


def test_identity_is_exact_when_every_source_has_quotes(monkeypatch):
    """With nothing missing there is no partiality and the no-residual rule
    applies in full: total == mtm + theta, exactly, at every level."""
    _pin_sources(monkeypatch, irs=True, credit=True,
                 today_snapshot=_snapshot(cd_rate=0.0335))
    res = pas.build_book_daily_pnl([_irs("P1"), _irs("P2"), _bond("B1")], _snapshot(), {})

    dp = res["daily_pnl"]
    assert dp["mtm_complete"] is True
    assert dp["total"] == dp["mtm"] + dp["theta"]
    for row in res["by_book"]:
        assert row["mtm_complete"] is True
        assert row["total"] == row["mtm"] + row["theta"]


def test_swap_total_matches_an_independent_revaluation(monkeypatch):
    """Pins the claim that the decomposition only re-splits the total, never
    moves it: mtm + theta must equal V(T, c_T) - V(close, c_close) computed
    straight from price_portfolio, with no reference to the split at all.

    V is DIRTY NPV (s11 T1): the clean basis dropped the daily accrued roll
    from both legs of the split while _bond_pnl decomposed dirty, so the
    aggregate mixed two bases and no reported NPV series reconciled with
    mtm + theta."""
    close = _snapshot()
    today = _snapshot(cd_rate=0.0340)
    _pin_sources(monkeypatch, irs=True, credit=True, today_snapshot=today)

    irs = [_irs("P1"), _irs("P2")]
    res = pas.build_book_daily_pnl(irs, close, {})

    swaps = [pas._to_swap(p) for p in irs]
    rolled_today = MarketSnapshot(
        valuation_date=_AS_OF, cd_rate=today.cd_rate,
        on_rate=today.on_rate, swap_quotes=today.swap_quotes,
    )
    v_close = sum(r.dirty_npv for r in
                  portfolio_service.price_portfolio(close, swaps, {}).position_results)
    v_today = sum(r.dirty_npv for r in
                  portfolio_service.price_portfolio(rolled_today, swaps, {}).position_results)

    assert res["daily_pnl"]["total"] == pytest.approx(v_today - v_close, rel=1e-12)


def test_funding_is_excluded_from_total(monkeypatch):
    """Funding is a financing cost, not a change in NPV. It must be reported but
    must not leak into total, or total stops meaning ΔNPV."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    res = pas.build_book_daily_pnl([_bond("B1")], _snapshot(), {}, funding_spread_bp=10.0)
    row = res["by_book"][0]
    assert row["funding"] < 0, "a funded bond position should show a financing cost"
    assert row["total"] == row["theta"]


# --- per-position behaviour, asserted on the leg builder directly -------------
# by_instrument is no longer in the payload (nothing renders 686 rows), so these
# exercise _bond_pnl, which is where the per-position decisions actually live.

def test_bond_without_static_params_is_kept_not_dropped():
    """A bond whose blotter row has no issue date can't be scheduled, so it
    can't be revalued -- but it still has carry. Dropping it would silently
    understate the book, so it falls back to an analytic split and is flagged."""
    bare = _bond("B-NOSTATIC")
    bare.issue_date = None
    bare.coupon_rate = None
    bare.payment_frequency = None

    legs = pas._bond_pnl([bare], _VALUATION_DATE, _AS_OF, False, 0.026)
    assert len(legs) == 1, "position vanished from the PnL"
    assert legs[0].theta != 0.0, "fallback must still carry"
    assert legs[0].degraded_reason is not None, "silent approximation -- must be reported"


def test_bond_with_static_params_is_revalued_not_approximated():
    """The revaluation path must do more than the analytic carry it replaces:
    rolling the valuation date also rolls the bond down its own curve, which
    eval x ytm/365 cannot see."""
    bare = _bond("B-FULL")
    bare.issue_date = None
    bare.coupon_rate = None
    bare.payment_frequency = None

    revalued = pas._bond_pnl([_bond("B-FULL")], _VALUATION_DATE, _AS_OF, False, 0.026)[0]
    analytic = pas._bond_pnl([bare], _VALUATION_DATE, _AS_OF, False, 0.026)[0]

    assert revalued.degraded_reason is None
    assert revalued.theta != analytic.theta


def test_duplicate_position_ids_do_not_collapse(monkeypatch):
    """The real blotter holds the same bond in several lots -- one id appears 9x.
    Anything that indexes PnL by position_id silently merges them and loses the
    book. Every lot must survive into the aggregate."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    lots = pas.build_book_daily_pnl([_bond("SAME"), _bond("SAME"), _bond("SAME")], _snapshot(), {})
    one = pas.build_book_daily_pnl([_bond("SAME")], _snapshot(), {})

    assert lots["daily_pnl"]["theta"] == pytest.approx(3 * one["daily_pnl"]["theta"], rel=1e-12)


# ---------------------------------------------------------------------------
# Coupon-day theta: a payment date inside (close, T] must not crater theta
# ---------------------------------------------------------------------------

def _swap_paying_on_as_of() -> PositionData:
    """A swap whose quarterly schedule lands a payment exactly on T=2026-06-30.

    trade_date 2025-06-27 (Fri) -> effective start next business day 2025-06-30,
    quarterly ISDA forward generation -> ..., 2026-03-30, 2026-06-30 (Tue, no
    modified-following shift). So one net cashflow sits in (close 6/29, T 6/30].
    """
    return PositionData(
        instrument_type="irs",
        position_id="P-COUPON",
        sector="IRS",
        book="Book A",
        start_date=date(2025, 6, 27),
        maturity_date=date(2030, 6, 30),
        notional=10_000_000_000.0,
        fixed_rate=0.0305,
        pay_fixed=False,  # receive fixed: net flow ~ +fixed - float, sign matters
        float_spread=0.0,
    )


def test_swap_theta_survives_a_coupon_crossing(monkeypatch):
    """Without the cash leg, theta on a payment date reports ~-(coupon PV): the
    flow leaves the schedule but the received cash is counted nowhere. Value
    isn't destroyed on a coupon date -- it converts to cash -- so theta must
    equal (rolled - close revaluation) PLUS the net cash paid in the window."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    pos = _swap_paying_on_as_of()
    close = _snapshot()

    res = pas.build_book_daily_pnl([pos], close, {})
    theta = res["daily_pnl"]["theta"]

    # Independent reconstruction of the pieces, straight from the engine.
    # Dirty basis, same as the decomposition itself (s11 T1).
    swaps = [pas._to_swap(pos)]
    r_close = portfolio_service.price_portfolio(close, swaps, {})
    v_close = sum(r.dirty_npv for r in r_close.position_results)
    rolled = MarketSnapshot(valuation_date=_AS_OF, cd_rate=close.cd_rate,
                            on_rate=close.on_rate, swap_quotes=close.swap_quotes)
    v_rolled = sum(r.dirty_npv for r in
                   portfolio_service.price_portfolio(rolled, swaps, {}).position_results)

    window = [pcf.detail for pcf in r_close.cashflows
              if _VALUATION_DATE < pcf.detail.payment_date <= _AS_OF]
    assert window, "test setup broken: no payment landed in (close, T]"
    net_cash = sum(
        (1.0 if d.leg == "fixed" else -1.0) * d.cashflow  # receive-fixed
        for d in window if d.cashflow is not None
    )
    assert net_cash != 0.0

    assert theta == pytest.approx(v_rolled - v_close + net_cash, rel=1e-12)
    # And the point of it all: theta is carry-sized, not coupon-sized. The bare
    # revaluation difference IS coupon-sized (that's the artifact).
    assert abs(theta) < abs(net_cash), (
        f"theta {theta:,.0f} still looks like a detached coupon ({net_cash:,.0f})"
    )


def _bond_paying_on_as_of() -> PositionData:
    """Semiannual bond with a coupon exactly on T=2026-06-30.

    issue 2023-06-30 -> generate_bond_schedule pays each Jun 30 / Dec 30 (with
    holiday shifts); verified 2026-06-30 lands unshifted. (2023-12-30 does NOT
    work -- its 2026 summer coupon shifts to 07-02.)
    """
    b = _bond("B-COUPON")
    b.issue_date = date(2023, 6, 30)
    b.maturity_date = date(2028, 6, 30)
    b.payment_frequency = 2
    return b


def test_bond_theta_survives_a_coupon_crossing(monkeypatch):
    """Same artifact, bond side: the 6/30 coupon leaves value_bond's schedule at
    T, and without the cash correction theta reports ~-coupon on a plain
    Tuesday. Theta must include the received coupon."""
    _pin_sources(monkeypatch, irs=False, credit=False)
    pos = _bond_paying_on_as_of()

    res = pas.build_book_daily_pnl([pos], _snapshot(), {})
    theta = res["daily_pnl"]["theta"]

    # The engine's own view of the coupon that detaches in the window.
    y_close = pas._bond_market_yield(pos, _VALUATION_DATE, pos.maturity_date)
    val_close = pas.bond_valuation.value_bond(
        asset_id=pos.position_id, issue_date=pos.issue_date,
        maturity_date=pos.maturity_date, coupon_rate=pos.coupon_rate,
        payment_frequency=pos.payment_frequency, notional=pos.notional,
        market_yield=y_close, val_date=_VALUATION_DATE,
    )
    detached = [c for c in val_close.cashflows
                if _VALUATION_DATE < c.payment_date <= _AS_OF]
    assert detached, "test setup broken: no coupon landed in (close, T]"
    coupon_cash = sum(c.cashflow for c in detached)
    assert coupon_cash > 0

    v_rolled = pas.bond_valuation.value_bond(
        asset_id=pos.position_id, issue_date=pos.issue_date,
        maturity_date=pos.maturity_date, coupon_rate=pos.coupon_rate,
        payment_frequency=pos.payment_frequency, notional=pos.notional,
        market_yield=y_close, val_date=_AS_OF,
    ).npv

    assert theta == pytest.approx(v_rolled - val_close.npv + coupon_cash, rel=1e-12)
    assert abs(theta) < coupon_cash, (
        f"theta {theta:,.0f} still craters by the detached coupon ({coupon_cash:,.0f})"
    )
