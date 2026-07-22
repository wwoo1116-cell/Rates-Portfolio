"""s13 T1 — old(clean) vs new(dirty+cash) endpoints for the trace regression
matrix (5M/6M/9M/1Y/7Y), plus the Home-vs-trace daily reconciliation.

Both bases are derived from ONE run of the migrated code: the points still
carry clean_npv/dirty_npv levels, so the retired clean-basis endpoint
(clean_last - clean_first) is reconstructable next to the shipped
cumulative_pnl. The delta must decompose exactly into
    Δaccrued (= Δ(dirty-clean))  +  settled cash
with zero residual — anything else would be a bug, not a basis effect.
"""
from __future__ import annotations

import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.stdout.reconfigure(encoding="utf-8")

from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import settled_cash_between
from irs_pricer.engine.quant_engine import next_kr_business_day
from irs_pricer.services import historical_pnl_service, market_data_service, npv_trace_service
from irs_pricer.services import portfolio_analytics_service as pas

TENORS_M = {"5M": 5, "6M": 6, "9M": 9, "1Y": 12, "7Y": 84}

dates = market_data_service.list_available_dates()
# 60 dates so the seasoned fixtures' first quarterly settlement falls INSIDE
# the window — the cash column below must be nonzero to demonstrate the
# no-sawtooth fold, not just the accrued roll.
window = dates[-60:]
fixings = market_data_service.load_fixings()
start, end = window[0], window[-1]
print(f"window: {start} .. {end}  ({len(window)} available dates)")

# 60d seasoning puts the first quarterly settlement (~start_dt + 91d) about a
# month INSIDE the window, so the cash column is exercised.
seasoned_start = start - timedelta(days=60)


def swap_for(months: int) -> VanillaSwap:
    return VanillaSwap(
        tenor_years=max(1, months // 12), notional=10_000_000_000.0,
        fixed_rate=0.0305, pay_fixed=False, trade_date=seasoned_start,
        maturity_date=seasoned_start + timedelta(days=int(months * 30.44) + 95),
    )


hdr = (f"{'fixture':<6}{'old cum (clean Δ)':>20}{'new cum (dirty+cash)':>22}"
       f"{'Δ = new-old':>16}{'Δaccrued':>14}{'cash':>16}{'residual':>10}")
print("\n== npv-trace cumulative endpoint (window above) ==")
print(hdr)
for label, months in TENORS_M.items():
    sw = swap_for(months)
    res = npv_trace_service.compute_npv_trace(sw, start, end)
    pts = res.points
    old = pts[-1].clean_npv - pts[0].clean_npv
    new = pts[-1].cumulative_pnl
    d_acc = (pts[-1].dirty_npv - pts[-1].clean_npv) - (pts[0].dirty_npv - pts[0].clean_npv)
    cash = settled_cash_between(sw, fixings, pts[0].valuation_date, pts[-1].valuation_date)
    resid = new - old - (d_acc + cash)
    print(f"{label:<6}{old:>20,.2f}{new:>22,.2f}{new - old:>16,.2f}{d_acc:>14,.2f}{cash:>16,.2f}{resid:>10,.4f}")

print("\n== historical-pnl cumulative endpoint (same window, 1-swap portfolio) ==")
print(hdr)
for label, months in TENORS_M.items():
    sw = swap_for(months)
    res = historical_pnl_service.compute_historical_pnl([(label, sw)], start, end)
    pts = res.points
    old = pts[-1].net_npv - pts[0].net_npv  # the retired clean-basis endpoint
    new = pts[-1].cumulative_pnl
    tr = npv_trace_service.compute_npv_trace(sw, start, end).points
    d_acc = (tr[-1].dirty_npv - tr[-1].clean_npv) - (tr[0].dirty_npv - tr[0].clean_npv)
    cash = settled_cash_between(sw, fixings, pts[0].valuation_date, pts[-1].valuation_date)
    resid = new - old - (d_acc + cash)
    print(f"{label:<6}{old:>20,.2f}{new:>22,.2f}{new - old:>16,.2f}{d_acc:>14,.2f}{cash:>16,.2f}{resid:>10,.4f}")

# ── Home Daily PnL vs trace daily, last adjacent pair (task 1.5) ────────────
pairs = [(a, b) for a, b in zip(dates, dates[1:]) if next_kr_business_day(a) == b]
close_d, as_of = pairs[-1]
sw = swap_for(12)
pos = pas.PositionData(
    instrument_type="irs", position_id="S13-RECON", sector="IRS", book="G",
    start_date=sw.trade_date, maturity_date=sw.maturity_date,
    notional=sw.notional, fixed_rate=sw.fixed_rate, pay_fixed=sw.pay_fixed, float_spread=0.0,
)
close_snap = market_data_service.load_snapshot(close_d)
book = pas.build_book_daily_pnl([pos], close_snap, fixings)
dp = book["daily_pnl"]
trace = npv_trace_service.compute_npv_trace(sw, close_d, as_of)
trace_daily = trace.points[-1].daily_pnl
print(f"\n== Home vs trace reconciliation ({close_d} -> {as_of}, 1Y fixture) ==")
print(f"  Home daily_pnl.total (theta+mtm) = {dp['total']:>18,.2f}"
      f"   (theta {dp['theta']:,.2f}, mtm {dp['mtm']:,.2f}, "
      f"realized_cash {dp['realized_cash']:,.2f}, complete={dp['mtm_complete']})")
print(f"  trace daily_pnl at {as_of}       = {trace_daily:>18,.2f}")
print(f"  |diff|                            = {abs(dp['total'] - trace_daily):,.6f}")
