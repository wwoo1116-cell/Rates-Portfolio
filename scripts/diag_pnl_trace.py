"""
DIAGNOSIS ONLY -- PnL Trace first-reset valuation cliff.

Headless reproduction of the UI runs (no HTTP, no MySQL -- the DB path is
force-disabled below so everything reads from Data/True Data.xlsx exactly
like a fresh install).

Fixture (Run C): trade 2025-04-15, maturity 2025-10-15, pay-fixed 3%,
notional 10bn KRW. Also reproduces Run A / Run B / 7Y for cross-checking.

Usage:  python scripts/diag_pnl_trace.py > scripts/diag_pnl_trace_out.txt
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
    # what value_booked_trade will actually use as the current-stub rate
    if raw is not None:
        used_pct_label = f"current_float_rate={raw!r} passed AS-IS; engine does /100 -> float_rate0={raw/100.0:.6f} (decimal)"
    else:
        used_pct_label = "current_float_rate=None -> engine computes forward*100 (percent) itself"
    print(f"[stub  ] {used_pct_label}")

    res = value_booked_trade(swap, curve, raw)

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
    print(f"  tooltip DV01 (pv_fixed_leg/(rate*1e4)) = {delta:14,.0f} KRW/bp")

    # -- counterfactuals ----------------------------------------------------
    if raw is not None:
        res_pct = value_booked_trade(swap, curve, raw * 100.0)  # fixing passed as PERCENT (what engine expects)
        res_fwd = value_booked_trade(swap, curve, None)         # engine's own forward fallback
        print(f"  [counterfactual] dirty if fixing passed as PERCENT ({raw*100.0:.4f}): {res_pct.dirty_npv:16,.0f}")
        print(f"  [counterfactual] dirty if fixing=None (forward fallback)      : {res_fwd.dirty_npv:16,.0f}")
        print(f"  => unit-mismatch impact on dirty_npv: {res.dirty_npv - res_pct.dirty_npv:16,.0f}")
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
    print("UNIT CHECK: values ~0.02-0.04 => DECIMAL. mtm_valuation.value_booked_trade divides by 100 again.")

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
    res_u = value_booked_trade(runC, curve_u, fix_u)
    res_v = value_booked_trade(runC, curve_v, fix_v)

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

    # tie the jump to the unit-mismatch term
    t_next_v = (irsC.pay_dates[1] - v).days / 365.0
    df_v = df_linear_rate(t_next_v, curve_v.yield_curve)
    alpha1 = irsC.accruals[1]
    print(f"\n  error-term prediction:")
    print(f"    (a) missing float CREDIT: alpha0={irsC.accruals[0]:.6f}, fixing_used(u)={fix_u!r} -> credited N*({fix_u}/100)*a0")
    print(f"        credited float = {1e10*(fix_u/100.0)*irsC.accruals[0]:16,.0f}   vs true N*fix*a0 = {1e10*fix_u*irsC.accruals[0]:16,.0f}")
    print(f"    (b) new stub mispricing on v: N*fix(v)*a1*DF = 10bn*{fix_v}*{alpha1:.6f}*{df_v:.6f}")
    print(f"        = {1e10*fix_v*alpha1*df_v:16,.0f}  (this PV goes missing from dirty(v))")
    cf_fixed_pay = 1e10 * 0.03 * irsC.accruals[0]
    true_credit = 1e10 * (fix_u - 0.03) * irsC.accruals[0]
    print(f"    true net settlement would be N*(fix-3%)*a0 = {true_credit:16,.0f}")
    print(f"    bug net settlement          = {credits:16,.0f}")

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
        _, fx = fixing_lookup(fixings, d)
        res = value_booked_trade(runB, curve, fx)
        delta = res.pv_fixed_leg / (runB.fixed_rate * 10000.0)
        # true DV01: rebuild curve with all par rates +1bp, keep the (broken) stub fixing input identical
        bumped = type(snap)(valuation_date=snap.valuation_date, cd_rate=snap.cd_rate + 1e-4,
                            swap_quotes=[type(q)(tenor_years=q.tenor_years, rate=q.rate + 1e-4,
                                                 tenor_months=q.tenor_months) for q in snap.swap_quotes],
                            on_rate=(snap.on_rate + 1e-4) if snap.on_rate is not None else None)
        res_up = value_booked_trade(runB, build_curve(bumped), fx)
        true_dv01 = -(res_up.dirty_npv - res.dirty_npv)
        # and the true DV01 of a CORRECTLY priced swap (fixing in percent)
        res_ok = value_booked_trade(runB, curve, fx * 100.0)
        res_ok_up = value_booked_trade(runB, build_curve(bumped), fx * 100.0)
        true_dv01_ok = -(res_ok_up.dirty_npv - res_ok.dirty_npv)
        print(f"{d}: tooltip delta={delta:12,.0f} | bump-reval DV01 (buggy stub)={true_dv01:12,.0f} | "
              f"bump-reval DV01 (percent stub)={true_dv01_ok:12,.0f}")

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

    # counterfactual 7Y: same loop but fixing passed as PERCENT
    hr("7Y COUNTERFACTUAL -- same trace with fixing passed as percent (unit bug fixed)")
    window = [d for d in avail if date(2019, 5, 28) <= d <= date(2026, 5, 28)]
    cum, prev_total, cum_cf, prev_res = 0.0, None, 0.0, None
    firsts = {}
    for vd in window:
        try:
            snap = mds.load_snapshot(vd)
        except Exception:
            continue
        curve = build_curve(snap)
        _, fx = fixing_lookup(fixings, vd)
        res = value_booked_trade(run7, curve, fx * 100.0 if fx is not None else None)
        if prev_res is not None:
            for cf in prev_res.cashflows:
                if cf.payment_date <= vd:
                    s = (-1.0 if run7.pay_fixed else 1.0) if cf.leg == "fixed" else (1.0 if run7.pay_fixed else -1.0)
                    cum_cf += s * (cf.cashflow or 0.0)
        total = res.dirty_npv + cum_cf
        if prev_total is not None:
            cum += total - prev_total
        prev_total, prev_res = total, res
    print(f"7Y corrected-units final cum = {cum:,.0f}  (buggy path final = {res7.points[-1].cumulative_pnl:,.0f})")
    print(f"difference attributable to the unit bug across all resets = {res7.points[-1].cumulative_pnl - cum:,.0f}")

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
