"""PnL-trace regression matrix against the real workbook (DIAG_PNL_TRACE.md
section 10 F4): 5M / 6M / 9M / 1Y / 7Y pay-fixed 10bn KRW fixtures.

Per fixture:
  1. no reset-day cliff -- a crossing day's PnL is a settlement replacing its
     own PV plus the genuine market move, so it must not be an outlier vs the
     trace's ordinary days (the bug made crossings ~-N*CD*alpha = 30x the
     largest genuine move); short tenors additionally get the absolute
     N x 5bp bound from F4.2;
  2. settlement identity, the faithful-fixture arithmetic -- the final
     cumulative PnL telescopes to
         sum of signed settlements N*(fix(F(R_k)) - K)*alpha_k
         + terminal dirty NPV - entry dirty NPV
     with settlements recomputed here from the schedule + fixing store,
     asserted to 1 KRW (F4.3/F4.4);
  3. DV01 decays (|delta| non-increasing) across the whole trace (F3);
  4. anchors: the 6M (Run C) and 7Y finals are pinned to the corrected
     values so any future drift is loud. The 7Y is NOT the diagnosis's
     +500.8m counterfactual: that rerun still re-fixed daily off the
     valuation-date CD, while the desk convention fixes each period at
     F(R) = reset - 1 Seoul business day (period-START fixing). See
     SESSION6_REPORT.md for the reconciliation.

Skipped wholesale when the real Data/ workbooks aren't present.
"""

from __future__ import annotations

from datetime import date

import pytest

from irs_pricer.config import DATA_DIR
from irs_pricer.engine.fixings import select_fixing
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.services import market_data_service as mds
from irs_pricer.services.npv_trace_service import compute_npv_trace

pytestmark = pytest.mark.skipif(
    not (DATA_DIR / "True Data.xlsx").exists(),
    reason="real Data/ workbooks not present",
)

NOTIONAL = 10_000_000_000.0
FIXED = 0.03

# tenor label -> (trade_date, maturity_date, pinned final cumulative PnL).
# Anchors were computed by the corrected engine on the 2026-07-15 workbook and
# reconcile to the won with the independent settlement arithmetic asserted in
# test_settlement_identity_to_the_won (e.g. the 6M: settlements
# 10bn x [(0.0281-0.03) + (0.0251-0.03)] x 91/365 = -16,952,904 minus the
# -21,130,136 entry mark -> +4,176,712 to the won). They supersede the buggy
# UI values (6M read -58,322,777) and the diagnosis's +500.8m 7Y counterfactual
# (which still re-fixed daily off the valuation-date CD; the desk convention
# fixes at F(R) = reset - 1 Seoul BD, hence +476.9m -- see SESSION6_REPORT.md).
CASES: dict[str, tuple[date, date, float]] = {
    "5M": (date(2025, 5, 15), date(2025, 10, 15), 189_335.08),
    "6M": (date(2025, 4, 15), date(2025, 10, 15), 4_176_711.63),   # diagnosis Run C
    "9M": (date(2025, 1, 15), date(2025, 10, 15), 437_204.93),
    "1Y": (date(2024, 10, 15), date(2025, 10, 15), -10_164_556.43),
    "7Y": (date(2019, 5, 28), date(2026, 5, 28), 476_880_352.08),  # diagnosis 7Y run
}


@pytest.fixture(autouse=True)
def _force_excel_source(monkeypatch):
    monkeypatch.setattr(mds, "_db_market_data_unavailable", True)


_trace_cache: dict[str, object] = {}


def _trace(label: str):
    """One trace per tenor per session -- the 7Y alone revalues ~1,700 dates
    twice (base + DV01 bump), so recomputing it per assertion would dominate
    the suite's runtime."""
    if label not in _trace_cache:
        trade, maturity, _ = CASES[label]
        swap = VanillaSwap(
            tenor_years=0.5, notional=NOTIONAL, fixed_rate=FIXED, pay_fixed=True,
            trade_date=trade, maturity_date=maturity,
        )
        _trace_cache[label] = (swap, compute_npv_trace(swap, trade, maturity))
    return _trace_cache[label]


def _crossing_points(swap, result):
    """(pay_date, first traced point on/after it) pairs."""
    irs = swap.to_irs_trade(swap.trade_date)
    out = []
    for pd_ in irs.pay_dates:
        after = [p for p in result.points if p.valuation_date >= pd_]
        if after:
            out.append((pd_, after[0]))
    return out


@pytest.mark.parametrize("label", CASES)
def test_no_reset_day_cliff(label):
    swap, result = _trace(label)
    crossings = _crossing_points(swap, result)
    crossing_dates = {p.valuation_date for _, p in crossings}
    ordinary = [abs(p.daily_pnl) for p in result.points[1:]
                if p.valuation_date not in crossing_dates]
    envelope = max(ordinary)

    for pay, point in crossings:
        # A crossing must look like an ordinary market day, not a step of
        # -N*CD*alpha (~60-100m). Margin: one ordinary-day envelope plus
        # 10bp of carry noise for multi-day gaps around skipped dates.
        bound = envelope * 1.5 + NOTIONAL * 0.0001 * 10
        assert abs(point.daily_pnl) <= bound, (
            f"{label}: crossing {pay} daily_pnl={point.daily_pnl:,.0f} "
            f"vs ordinary envelope {envelope:,.0f}"
        )
        if label != "7Y":
            # F4.2 absolute bound for the short tenors: N x 5bp.
            assert abs(point.daily_pnl) <= NOTIONAL * 0.0005, (
                f"{label}: crossing {pay} daily_pnl={point.daily_pnl:,.0f} "
                f"exceeds N x 5bp"
            )


@pytest.mark.parametrize("label", CASES)
def test_settlement_identity_to_the_won(label):
    """final cum == sum of independently recomputed signed settlements
    + terminal dirty - entry dirty, to 1 KRW (F4.3/F4.4)."""
    swap, result = _trace(label)
    fixings = mds.load_fixings()
    irs = swap.to_irs_trade(swap.trade_date)
    last = result.points[-1].valuation_date

    settlements = 0.0
    for k, pay in enumerate(irs.pay_dates):
        if pay > last:
            continue
        reset = irs.pay_dates[k - 1] if k > 0 else irs.start_date
        res = select_fixing(fixings, reset, valuation_date=last)
        assert res is not None and res.rate is not None, f"{label}: no fixing for reset {reset}"
        # pay-fixed: receive float, pay fixed.
        settlements += NOTIONAL * (res.rate - FIXED) * irs.accruals[k]

    expected = settlements + result.points[-1].dirty_npv - result.entry_npv
    assert result.points[-1].cumulative_pnl == pytest.approx(expected, abs=1.0), label


@pytest.mark.parametrize("label", CASES)
def test_dv01_decays_across_the_trace(label):
    """|DV01| rolls off with remaining maturity. Day over day it may tick up
    with the market (a rate rally raises DFs and with them the annuity --
    measured ~+0.3%/day on the 7Y), so daily moves get a small proportional
    allowance; the STRUCTURAL decay is asserted at reset granularity, where
    a whole period's risk drops off and market wiggle cannot mask it."""
    swap, result = _trace(label)
    mags = [abs(p.delta) for p in result.points]

    daily_viol = [
        (result.points[i].valuation_date, mags[i], mags[i + 1])
        for i in range(len(mags) - 1)
        if mags[i + 1] > mags[i] * 1.01 + 2_000
    ]
    assert not daily_viol, f"{label}: DV01 jumped day-over-day at {daily_viol[:3]}"

    reset_mags = [abs(p.delta) for _, p in _crossing_points(swap, result)]
    sampled = [mags[0]] + reset_mags
    reset_viol = [
        (sampled[i], sampled[i + 1])
        for i in range(len(sampled) - 1)
        if sampled[i + 1] > sampled[i] * 1.02
    ]
    assert not reset_viol, f"{label}: no decay across resets: {reset_viol[:3]}"

    assert mags[-1] < 5_000, f"{label}: terminal DV01 {mags[-1]:,.0f} not ~0"
    assert mags[0] == max(mags[0], mags[-1])


@pytest.mark.parametrize("label", CASES)
def test_final_cumulative_pnl_anchor(label):
    _, result = _trace(label)
    assert result.points[-1].cumulative_pnl == pytest.approx(CASES[label][2], abs=5.0), label


def test_no_fixing_data_quality_warnings_on_the_real_store():
    """Every F(R) in the matrix is a Seoul business day inside the store's
    coverage, so a healthy workbook must produce zero ffill substitutions."""
    for label in CASES:
        _, result = _trace(label)
        assert result.fixing_warnings == [], f"{label}: {result.fixing_warnings[:3]}"
