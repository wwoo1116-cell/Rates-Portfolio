"""
PnL Trace repro harness -- originally the Session-5 diagnosis script for the
first-reset valuation cliff; adapted in Session 6 to the corrected engine API
(value_booked_trade now takes the whole fixings dict; selection is
reset-date-based in engine/fixings.py) so the same sections re-run post-fix.
Diff scripts/diag_pnl_trace_out.txt (buggy baseline, pre-fix) against
scripts/diag_pnl_trace_out_postfix.txt to see the valuation impact.

Headless reproduction of the UI runs (no HTTP, no MySQL -- the DB path is
force-disabled below so everything reads from Data/True Data.xlsx exactly
like a fresh install).

Fixture (Run C): trade 2025-04-15, maturity 2025-10-15, pay-fixed 3%,
notional 10bn KRW. Also reproduces Run A / Run B / 7Y for cross-checking.

Usage:  python scripts/diag_pnl_trace.py > scripts/diag_pnl_trace_out_postfix.txt
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.services import market_data_service as mds

# ── HARD-DISABLE MySQL: diagnosis must not touch the DB ─────────────────────
mds._db_market_data_unavailable = True

from irs_pricer.engine.curve import build_curve
from irs_pricer.engine.fixings import select_fixing
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.engine.mtm_valuation import value_booked_trade
from irs_pricer.engine.quant_engine import (
    _KR_HOLIDAYS,
    _is_kr_business_day,
    df_linear_rate,
    forward_rate_simple,
    next_kr_business_day,
)
from irs_pricer.services.npv_trace_service import compute_npv_trace

W = 110


def hr(title: str) -> None:
    print("\n" + "=" * W)
    print(title)
    print("=" * W)


def day_flags(d: date) -> str:
    wd = d.strftime("%a")
    flags = [wd]
    if d.weekday() >= 5:
        flags.append("WEEKEND")
    if d in _KR_HOLIDAYS:
        flags.append("KR-HOLIDAY")
    return "/".join(flags)


def fixing_lookup(fixings: dict[date, float], val_date: date):
    """Replicates compute_npv_trace's fixing selection, instrumented."""
    past = {k: v for k, v in fixings.items() if k <= val_date}
    if not past:
        return None, None
    key = max(past.keys())
    return key, past[key]


def dump_valuation(swap: VanillaSwap, val_date: date, fixings: dict[date, float]):
    """Per-date valuation breakdown: every cashflow, every lookup, both legs."""
    hr(f"VALUATION BREAKDOWN  val_date={val_date} ({day_flags(val_date)})")

    # -- rate-history lookups, instrumented --------------------------------
    try:
        snapshot = mds.load_snapshot(val_date)
        print(f"[lookup] load_snapshot({val_date}): HIT  cd_rate={snapshot.cd_rate!r} (decimal), "
              f"on_rate={snapshot.on_rate!r}, n_swap_quotes={len(snapshot.swap_quotes)}")
    except Exception as e:
        print(f"[lookup] load_snapshot({val_date}): MISS -> {type(e).__name__}: {e}")
        return None

    key, raw = fixing_lookup(fixings, val_date)
    print(f"[lookup] fixings ffill: requested<= {val_date} -> resolved key={key} "
          f"({'HIT ffill' if key else 'MISS -> None'}), raw value={raw!r}")

    curve = build_curve(snapshot)
    print(f"[curve ] nodes (T yrs, zero r): "
          + ", ".join(f"({t:.4f},{r:.5f})" for t, r in curve.yield_curve[:5])
          + f" ... ({curve.yield_curve[-1][0]:.2f},{curve.yield_curve[-1][1]:.5f})"
          + f"  | shortest par node T={min(t for t, _ in curve.par_rates):.5f}")

    irs = swap.to_irs_trade(val_date)
    # POST-FIX: the whole fixings dict goes to the engine; each period fixes
    # at F(R) = reset - 1 Seoul BD (engine/fixings.py). The valuation-date
    # ffill above is printed only to show what the OLD selection would have
    # used.
    print(f"[stub  ] old val-date ffill would have used {raw!r}; "
          f"engine now resolves per-period reset-date fixings itself")

    res = value_booked_trade(swap, curve, fixings)
    for fr in res.fixing_resolutions:
        print(f"[fixing] reset={fr.reset_date} F(R)={fr.fixing_date} -> "
              f"{fr.resolved_date} rate={fr.rate!r} exact={fr.is_exact}")

    print(f"\n{'leg':8} {'accr_start':>10} {'accr_end':>10} {'pay_date':>10} {'adj?':>5} "
          f"{'dcf':>8} {'rate_used':>10} {'known':>5} {'cashflow':>16} {'DF(t_pay)':>10} {'PV':>16}")
    for cf in res.cashflows:
        t_pay = (cf.payment_date - val_date).days / 365.0
        dfp = df_linear_rate(t_pay, curve.yield_curve)
        dcf = (cf.accrual_end - cf.accrual_start).days / 365.0
        adj = "BD" if _is_kr_business_day(cf.payment_date) else "NBD!"
        print(f"{cf.leg:8} {cf.accrual_start} {cf.accrual_end} {cf.payment_date} {adj:>5} "
              f"{dcf:8.5f} {cf.rate:10.6f} {str(cf.is_known):>5} {cf.cashflow:16,.0f} {dfp:10.6f} {cf.pv:16,.0f}")

    print(f"\n  pv_fixed_leg={res.pv_fixed_leg:16,.0f}   pv_floating_leg={res.pv_floating_leg:16,.0f}")
    print(f"  dirty_npv   ={res.dirty_npv:16,.0f}   clean_npv     ={res.clean_npv:16,.0f}   accrued={res.accrued_interest:14,.0f}")
    delta = res.pv_fixed_leg / (swap.fixed_rate * 10000.0) if swap.fixed_rate else 0.0
    print(f"  OLD proxy DV01 (pv_fixed_leg/(rate*1e4)) = {delta:14,.0f} KRW/bp  "
          f"(tooltip now reports bump-reval; see DV01 CHECK section)")

    # -- counterfactual -----------------------------------------------------
    # The percent/double-division counterfactuals of the diagnosis run are no
    # longer expressible: the engine consumes the decimal store verbatim.
    res_fwd = value_booked_trade(swap, curve, None)  # forward-only fallback
    print(f"  [counterfactual] dirty if fixings=None (forward fallback): {res_fwd.dirty_npv:16,.0f}")
    print(f"  => fixing-vs-forward impact on dirty_npv: {res.dirty_npv - res_fwd.dirty_npv:16,.0f}")
    return res


def schedule_table(label: str, swap: VanillaSwap, any_val_date: date):
    irs = swap.to_irs_trade(any_val_date)
    hr(f"SCHEDULE  {label}: trade={swap.trade_date} effective(T+1)={irs.start_date} "
       f"({day_flags(irs.start_date)}) maturity={swap.maturity_date}")
    print(f"{'#':>3} {'pay_date(ModFol)':>16} {'flags':>16} {'accrual(ACT/365)':>17} {'days':>5}")
    prev = irs.start_date
    for i, (pd_, ac) in enumerate(zip(irs.pay_dates, irs.accruals)):
        print(f"{i:>3} {pd_.isoformat():>16} {day_flags(pd_):>16} {ac:17.6f} {(pd_ - prev).days:>5}")
        prev = pd_
    return irs


def trace_and_report(label: str, swap: VanillaSwap, start: date, end: date,
                     show_all_crossings: bool = False):
    hr(f"FULL TRACE  {label}  window=[{start} .. {end}]")
    result = compute_npv_trace(swap, start, end)
    pts = result.points
    print(f"points={len(pts)}  skipped={len(result.skipped_dates)}  entry_npv(dirty@first)={result.entry_npv:,.0f}")
    print(f"first={pts[0].valuation_date}  last={pts[-1].valuation_date}  final cum={pts[-1].cumulative_pnl:,.0f}")
    worst = min(pts, key=lambda p: p.daily_pnl)
    best = max(pts, key=lambda p: p.daily_pnl)
    print(f"worst daily_pnl: {worst.daily_pnl:,.0f} on {worst.valuation_date}")
    print(f"best  daily_pnl: {best.daily_pnl:,.0f} on {best.valuation_date}")
    if show_all_crossings:
        irs = swap.to_irs_trade(start)
        pays = set(irs.pay_dates)
        print("\ncrossing-day daily PnL (first point on/after each pay date):")
        for pd_ in sorted(pays):
            after = [p for p in pts if p.valuation_date >= pd_]
            if after:
                p = after[0]
                print(f"  pay {pd_} -> first traced point {p.valuation_date}: daily_pnl={p.daily_pnl:15,.0f}  cum={p.cumulative_pnl:15,.0f}")
    return result


def main() -> None:
    fixings = mds.load_fixings()
    fdates = sorted(fixings.keys())
    hr("FIXING HISTORY SOURCE")
    print(f"n={len(fixings)}  range=[{fdates[0]} .. {fdates[-1]}]")
    sample = fdates[len(fdates)//2]
    print(f"sample: fixings[{fdates[-1]}]={fixings[fdates[-1]]!r}  fixings[{sample}]={fixings[sample]!r}")
    print("UNIT CHECK: values ~0.02-0.04 => DECIMAL. POST-FIX: the engine consumes the decimal store verbatim.")

    avail = mds.list_available_dates()
    print(f"\navailable market dates: n={len(avail)} range=[{avail[0]} .. {avail[-1]}]")

    # ═════════════════ RUN C ═════════════════
    runC = VanillaSwap(tenor_years=0.5, notional=1e10, fixed_rate=0.03, pay_fixed=True,
                       trade_date=date(2025, 4, 15), maturity_date=date(2025, 10, 15))
    irsC = schedule_table("Run C (6M)", runC, date(2025, 4, 15))

    # T candidates: user says cliff 2025-07-15; schedule says first pay = irsC.pay_dates[0]
    first_pay = irsC.pay_dates[0]
    print(f"\nfirst pay date per engine schedule: {first_pay}  (user-observed cliff: 2025-07-15)")

    for d in [date(2025, 7, 14), date(2025, 7, 15), date(2025, 7, 16), date(2025, 7, 17)]:
        dump_valuation(runC, d, fixings)

    resC = trace_and_report("Run C", runC, date(2025, 4, 15), date(2025, 10, 15))

    # ── arithmetic reconciliation of the jump ──────────────────────────────
    hr("RUN C -- CLOSED-FORM RECONCILIATION OF THE JUMP")
    pts = {p.valuation_date: p for p in resC.points}
    u, v = date(2025, 7, 15), date(2025, 7, 16)
    snap_u, snap_v = mds.load_snapshot(u), mds.load_snapshot(v)
    curve_u, curve_v = build_curve(snap_u), build_curve(snap_v)
    _, fix_u = fixing_lookup(fixings, u)
    _, fix_v = fixing_lookup(fixings, v)
    res_u = value_booked_trade(runC, curve_u, fixings)
    res_v = value_booked_trade(runC, curve_v, fixings)

    credits = 0.0
    print("cashflows credited on v (from prev_result=res_u, payment_date <= v):")
    for cf in res_u.cashflows:
        if cf.payment_date <= v:
            sign = -1.0 if (cf.leg == "fixed") == runC.pay_fixed else 1.0
            # pay_fixed: fixed -> -1, floating -> +1  (matches npv_trace_service)
            sign = (-1.0 if runC.pay_fixed else 1.0) if cf.leg == "fixed" else (1.0 if runC.pay_fixed else -1.0)
            credits += sign * (cf.cashflow or 0.0)
            print(f"  {cf.leg:8} pay {cf.payment_date}  rate_used={cf.rate:.6f}  amount={cf.cashflow:16,.0f}  signed={sign*(cf.cashflow or 0.0):16,.0f}")
    daily = (res_v.dirty_npv + credits) - res_u.dirty_npv
    print(f"\n  dirty(u={u}) = {res_u.dirty_npv:16,.0f}")
    print(f"  dirty(v={v}) = {res_v.dirty_npv:16,.0f}")
    print(f"  credits       = {credits:16,.0f}")
    print(f"  daily_pnl(v) = dirty(v) + credits - dirty(u) = {daily:16,.0f}")
    print(f"  service's own daily_pnl({v}) = {pts[v].daily_pnl:16,.0f}   (must match)")

    # POST-FIX: settlement identity against the reset-date fixing convention.
    r1 = irsC.start_date  # first period's reset date
    fr1 = select_fixing(fixings, r1, u)
    print(f"\n  settlement identity (F(R) convention):")
    print(f"    reset R1={r1} -> F(R1)={fr1.fixing_date} -> fixing {fr1.rate!r} "
          f"(exact={fr1.is_exact})")
    true_float_credit = 1e10 * fr1.rate * irsC.accruals[0]
    credited_float = next(cf.cashflow for cf in res_u.cashflows
                          if cf.leg == "floating" and cf.payment_date <= v)
    print(f"    N*fix(F(R1))*a0 = {true_float_credit:16,.0f}   credited float = {credited_float:16,.0f}"
          f"   diff = {credited_float - true_float_credit:.2f}")
    print(f"    net settlement N*(fix-3%)*a0 = {1e10*(fr1.rate-0.03)*irsC.accruals[0]:16,.0f}"
          f"   (old val-date ffill would have used {fix_u!r})")

    # ── freeze mechanism ───────────────────────────────────────────────────
    hr("RUN C -- POST-CLIFF 'FREEZE' (daily PnL after first pay date)")
    post = [p for p in resC.points if p.valuation_date > first_pay]
    print(f"{'date':>12} {'daily_pnl':>14} {'cum_pnl':>16} {'dirty_npv':>16} {'delta(tooltip)':>14}")
    for p in post[:8]:
        print(f"{p.valuation_date} {p.daily_pnl:14,.0f} {p.cumulative_pnl:16,.0f} {p.dirty_npv:16,.0f} {p.delta:14,.0f}")
    print("  ...")
    for p in post[-4:]:
        print(f"{p.valuation_date} {p.daily_pnl:14,.0f} {p.cumulative_pnl:16,.0f} {p.dirty_npv:16,.0f} {p.delta:14,.0f}")
    mx = max(abs(p.daily_pnl) for p in post[:-1]) if len(post) > 1 else 0.0
    print(f"max |daily_pnl| strictly between first pay and maturity = {mx:,.0f} KRW")

    # ── DV01 check: tooltip proxy vs true bump-reval ───────────────────────
    hr("DV01 CHECK -- tooltip proxy vs true +1bp parallel bump (Run B fixture)")
    runB = VanillaSwap(tenor_years=0.5, notional=1e10, fixed_rate=0.03, pay_fixed=True,
                       trade_date=date(2026, 1, 6), maturity_date=date(2026, 7, 6))
    irsB = schedule_table("Run B (Jan6->Jul6)", runB, date(2026, 1, 6))
    for d in [date(2026, 4, 3), date(2026, 4, 6), date(2026, 4, 7), date(2026, 4, 8)]:
        if d not in avail:
            print(f"{d}: not an available market date, skipped")
            continue
        snap = mds.load_snapshot(d)
        curve = build_curve(snap)
        res = value_booked_trade(runB, curve, fixings)
        proxy = res.pv_fixed_leg / (runB.fixed_rate * 10000.0)
        # the tooltip's new definition: all par nodes +1bp, re-bootstrap,
        # revalue with the same fixings (date-based selection holds them
        # constant across the bump), DV01 = -(NPV_up - NPV_base).
        bumped = type(snap)(valuation_date=snap.valuation_date, cd_rate=snap.cd_rate + 1e-4,
                            swap_quotes=[type(q)(tenor_years=q.tenor_years, rate=q.rate + 1e-4,
                                                 tenor_months=q.tenor_months) for q in snap.swap_quotes],
                            on_rate=(snap.on_rate + 1e-4) if snap.on_rate is not None else None)
        res_up = value_booked_trade(runB, build_curve(bumped), fixings)
        true_dv01 = -(res_up.dirty_npv - res.dirty_npv)
        print(f"{d}: OLD proxy delta={proxy:12,.0f} | bump-reval DV01 (now the tooltip)={true_dv01:12,.0f}")

    # ── Runs A & B full traces ─────────────────────────────────────────────
    runA = VanillaSwap(tenor_years=0.5, notional=1e10, fixed_rate=0.03, pay_fixed=True,
                       trade_date=date(2026, 2, 6), maturity_date=date(2026, 7, 6))
    schedule_table("Run A (Feb6->Jul6)", runA, date(2026, 2, 6))
    trace_and_report("Run A (UI final: -44,410,000)", runA, date(2026, 2, 6), date(2026, 7, 6), show_all_crossings=True)
    trace_and_report("Run B (UI final: -44,410,000; cliff 2026-04-06)", runB, date(2026, 1, 6), date(2026, 7, 6), show_all_crossings=True)

    # ── 7Y run ─────────────────────────────────────────────────────────────
    run7 = VanillaSwap(tenor_years=7, notional=1e10, fixed_rate=0.03, pay_fixed=True,
                       trade_date=date(2019, 5, 28), maturity_date=date(2026, 5, 28))
    irs7 = run7.to_irs_trade(date(2019, 5, 28))
    hr("7Y SCHEDULE -- weekend/holiday resets (H3 discriminator)")
    prev = irs7.start_date
    nbd_raw = 0
    for i, pd_ in enumerate(irs7.pay_dates):
        raw_flag = ""
        # reconstruct the raw (unadjusted) date the ModFol saw: forward gen start + 3m*i
        print(f"{i:>3} pay={pd_} {day_flags(pd_):>14}  accrual={irs7.accruals[i]:.6f}")
    res7 = trace_and_report("7Y (UI: 'no cliff', peak +473.7m, final -1,070.43m)",
                            run7, date(2019, 5, 28), date(2026, 5, 28), show_all_crossings=True)

    # POST-FIX: the primary path above IS the corrected trace. Reconcile it
    # against the diagnosis's +500,828,297 counterfactual, which fixed the
    # UNITS but kept the OLD selection (stub re-fixed daily off the
    # valuation-date CD => each settlement credited at ~the period-END print).
    # The desk convention credits at the period-START print fix(F(R_k)); the
    # analytic difference is sum_k N*(fix(F(R_k)) - fix(F(pay_k)))*alpha_k.
    hr("7Y -- selection reconciliation vs the diagnosis's corrected-units counterfactual (+500,828,297)")
    DIAG_COUNTERFACTUAL = 500_828_297.0
    sel_delta = 0.0
    last7 = res7.points[-1].valuation_date
    for k, pay in enumerate(irs7.pay_dates):
        if pay > last7:
            continue
        reset = irs7.pay_dates[k - 1] if k > 0 else irs7.start_date
        f_start = select_fixing(fixings, reset, last7)
        f_end = select_fixing(fixings, pay, last7)  # ~ the print the old loop credited
        if f_start and f_end and f_start.rate is not None and f_end.rate is not None:
            sel_delta += 1e10 * (f_start.rate - f_end.rate) * irs7.accruals[k]
    measured = res7.points[-1].cumulative_pnl
    print(f"measured 7Y final cum (corrected engine)             = {measured:,.0f}")
    print(f"diagnosis counterfactual (val-date selection)        = {DIAG_COUNTERFACTUAL:,.0f}")
    print(f"difference                                           = {measured - DIAG_COUNTERFACTUAL:,.0f}")
    print(f"analytic start-vs-end-print settlement delta         = {sel_delta:,.0f}")
    print("(the two should be the same order; residual = stub-marking differences between resets)")

    # ── H2 sanity: curve coverage below shortest node ──────────────────────
    hr("H2 SANITY -- sub-3M interpolation on cliff dates (must be smooth, no 0/NaN)")
    for dd in [date(2025, 7, 15), date(2025, 7, 16)]:
        curve = build_curve(mds.load_snapshot(dd))
        zc = curve.yield_curve
        for t in [1/365, 7/365, 30/365, 60/365, 91/365, 0.4]:
            print(f"  {dd} t={t:8.5f}  df_linear_rate={df_linear_rate(t, zc):.8f}  "
                  f"fwd(t,t+0.25)={forward_rate_simple(t, t+0.25, zc):.6f}")


if __name__ == "__main__":
    main()
