"""S11 T1 diagnosis — reproduce & localize the NPV = MtM + Theta identity break.

For the latest adjacent market-data pair (close = T-1, T = next KR business day
with data on both sides), dump per instrument:

    NPV_{T-1}, NPV_T, reported theta, reported mtm, realized cash in (close, T],
    residual_raw  = (NPV_T - NPV_{T-1}) - (mtm + theta)
    residual_cash = (NPV_T - NPV_{T-1}) + cash - (mtm + theta)

for: real bonds (workbook, payment_frequency hydrated like blotter-parser.ts),
real IRS (workbook), a synthetic 5M/6M/9M/1Y/7Y IRS matrix (live-fixed), one
pre-fixing IRS (forward start), and the portfolio aggregate vs
build_book_daily_pnl's reported daily_pnl.

Read-only: no service code is imported for mutation; only public/underscore
entry points are called the way the router calls them.
"""
from __future__ import annotations

import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from irs_pricer.config import DATA_DIR
from irs_pricer.core.market_data import MarketSnapshot
from irs_pricer.engine import bond_valuation
from irs_pricer.engine.quant_engine import next_kr_business_day
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import market_data_service
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services import portfolio_service
from irs_pricer.services.portfolio_analytics_service import PositionData


def pick_pair() -> tuple[date, date]:
    dates = market_data_service.list_available_dates()
    for i in range(len(dates) - 1, 0, -1):
        d_prev, d_next = dates[i - 1], dates[i]
        if next_kr_business_day(d_prev) == d_next:
            return d_prev, d_next
    raise SystemExit("no adjacent business-day pair in the store")


def load_real_positions() -> tuple[list[PositionData], list[PositionData]]:
    raw = portfolio_loader.parse(DATA_DIR)
    bonds, swaps = [], []
    for p in raw:
        freq = p.get("payment_frequency")
        if p["instrument_type"] == "bond" and freq is None:
            # blotter-parser.ts rule: 국고/통안 semiannual, credit quarterly
            freq = 2 if p["sector"] in ("국고채", "통안채") else 4
        pd_kwargs = {k: v for k, v in p.items() if k in PositionData.__dataclass_fields__}
        pd_kwargs["payment_frequency"] = freq
        pos = PositionData(**pd_kwargs)
        (bonds if p["instrument_type"] == "bond" else swaps).append(pos)
    return bonds, swaps


def synthetic_matrix(close: date, as_of: date) -> list[PositionData]:
    """5M/6M/9M/1Y/7Y live-fixed receive-fixed IRS + one pre-fixing (fwd start)."""
    out = []
    tenors_m = {"5M": 5, "6M": 6, "9M": 9, "1Y": 12, "7Y": 84}
    start = close - timedelta(days=95)  # ~3M seasoned: first fixing consumed
    for label, months in tenors_m.items():
        maturity = start + timedelta(days=int(months * 30.44) + 95)
        out.append(PositionData(
            instrument_type="irs", position_id=f"SYN-{label}", sector="IRS",
            book="SYN", start_date=start, maturity_date=maturity,
            notional=10_000_000_000.0, fixed_rate=0.0305, pay_fixed=False,
            float_spread=0.0,
        ))
    out.append(PositionData(
        instrument_type="irs", position_id="SYN-PREFIX", sector="IRS",
        book="SYN", start_date=as_of + timedelta(days=14),
        maturity_date=as_of + timedelta(days=14 + 365 * 2),
        notional=10_000_000_000.0, fixed_rate=0.0305, pay_fixed=False,
        float_spread=0.0,
    ))
    return out


def main() -> None:
    close_date, as_of = pick_pair()
    print(f"pair: close={close_date}  T={as_of}")

    close_snap = market_data_service.load_snapshot(close_date)
    today_snap = market_data_service.load_snapshot(as_of)
    fixings = market_data_service.load_fixings()

    bonds, real_swaps = load_real_positions()
    syn = synthetic_matrix(close_date, as_of)
    irs_all = real_swaps + syn
    positions = bonds + irs_all

    # ---- what the service reports -------------------------------------------------
    res = pas.build_book_daily_pnl(positions, close_snap, fixings)
    sources = {s["source"]: s for s in res["quote_sources"]}
    print(f"quote_sources: IRS has_as_of={sources['IRS']['has_as_of']} "
          f"(latest {sources['IRS']['latest']}), "
          f"Credit has_as_of={sources['Credit Matrix']['has_as_of']} "
          f"(latest {sources['Credit Matrix']['latest']})")

    rolled_snap = pas._roll_quotes_to(close_snap, as_of)
    today_rolled = pas._roll_quotes_to(today_snap, as_of)

    swap_legs, _w = pas._swap_pnl(irs_all, close_snap, rolled_snap, today_snap, fixings)

    has_credit = sources["Credit Matrix"]["has_as_of"]
    bond_legs = pas._bond_pnl(bonds, close_date, as_of, has_credit, 0.0)

    # ---- independent revaluation (canonical NPV path) ------------------------------
    swaps = [pas._to_swap(p) for p in irs_all]
    r_close = portfolio_service.price_portfolio(close_snap, swaps, fixings)
    r_today = portfolio_service.price_portfolio(today_rolled, swaps, fixings)
    cash = pas._realized_swap_cash(irs_all, r_close.cashflows, close_date, as_of)

    rows = []
    for p, leg, rc, rt, c in zip(irs_all, swap_legs, r_close.position_results,
                                 r_today.position_results, cash):
        d_clean = rt.clean_npv - rc.clean_npv
        d_dirty = rt.dirty_npv - rc.dirty_npv
        split = (leg.mtm or 0.0) + leg.theta
        rows.append({
            "id": p.position_id, "type": "irs",
            # dirty basis -- the decomposition's own basis as of s11 T1
            "npv_prev": rc.dirty_npv, "npv_T": rt.dirty_npv,
            "theta": leg.theta, "mtm": leg.mtm, "cash": c,
            "resid_raw": d_dirty - split,
            "resid_cash": d_dirty + c - split,
            "resid_clean_ref": d_clean + c - split,
        })

    # bonds: replicate _bond_pnl's own valuation legs independently
    for p, leg in zip(bonds, bond_legs):
        row = {"id": p.position_id, "type": "bond", "theta": leg.theta,
               "mtm": leg.mtm, "degraded": leg.degraded_reason}
        try:
            y_close = pas._bond_market_yield(p, close_date, p.maturity_date)
            v_close = bond_valuation.value_bond(
                asset_id=p.position_id, issue_date=p.issue_date,
                maturity_date=p.maturity_date, coupon_rate=p.coupon_rate,
                payment_frequency=p.payment_frequency, notional=p.notional or 0.0,
                market_yield=y_close, val_date=close_date)
            y_today = pas._bond_market_yield(p, as_of, p.maturity_date)
            v_today = bond_valuation.value_bond(
                asset_id=p.position_id, issue_date=p.issue_date,
                maturity_date=p.maturity_date, coupon_rate=p.coupon_rate,
                payment_frequency=p.payment_frequency, notional=p.notional or 0.0,
                market_yield=y_today, val_date=as_of)
            realized = sum(c.cashflow for c in v_close.cashflows
                           if close_date < c.payment_date <= as_of and c.cashflow is not None)
            d_npv = v_today.npv - v_close.npv
            split = (leg.mtm or 0.0) + leg.theta
            row.update({
                "npv_prev": v_close.npv, "npv_T": v_today.npv, "cash": realized,
                "resid_raw": d_npv - split,
                "resid_cash": d_npv + realized - split,
            })
        except Exception as e:  # noqa: BLE001 - diagnosis, record and continue
            row["error"] = f"{type(e).__name__}: {e}"
        rows.append(row)

    # ---- print --------------------------------------------------------------------
    def fmt(v):
        if v is None:
            return "        —"
        return f"{v:>18,.2f}"

    interesting = [r for r in rows if r["type"] == "irs"] + \
                  [r for r in rows if r["type"] == "bond"][:8]
    hdr = f"{'id':<28}{'npv_prev':>18}{'npv_T':>18}{'theta':>16}{'mtm':>16}{'cash':>14}{'resid_raw':>14}{'resid_cash':>14}"
    print(hdr)
    for r in interesting:
        print(f"{r['id'][:27]:<28}"
              f"{fmt(r.get('npv_prev'))}{fmt(r.get('npv_T'))}"
              f"{r['theta']:>16,.2f}"
              f"{(f'{r['mtm']:>16,.2f}' if r['mtm'] is not None else '            None')}"
              f"{r.get('cash', 0.0):>14,.2f}"
              f"{r.get('resid_raw', float('nan')):>14,.4f}"
              f"{r.get('resid_cash', float('nan')):>14,.4f}"
              + (f"  DEGRADED: {r['degraded']}" if r.get("degraded") else "")
              + (f"  ERROR: {r['error']}" if r.get("error") else ""))

    bond_rows = [r for r in rows if r["type"] == "bond"]
    degraded = [r for r in bond_rows if r.get("degraded")]
    print(f"\nbonds: {len(bond_rows)} total, {len(degraded)} degraded (analytic fallback)")

    ok_rows = [r for r in rows if "resid_cash" in r]
    worst = sorted(ok_rows, key=lambda r: abs(r["resid_cash"]), reverse=True)[:10]
    print("\nworst |resid_cash| (identity incl. realized cash):")
    for r in worst:
        print(f"  {r['id'][:40]:<42} {r['resid_cash']:>16,.4f}"
              + ("  [degraded]" if r.get("degraded") else ""))

    # ---- aggregate ----------------------------------------------------------------
    d_clean_swaps = sum(r["resid_cash"] - r["resid_cash"] for r in rows)  # placeholder
    agg_dnpv = sum((r["npv_T"] - r["npv_prev"]) for r in ok_rows)
    agg_cash = sum(r.get("cash", 0.0) for r in ok_rows)
    agg_theta = sum(r["theta"] for r in rows)
    agg_mtm_known = sum(r["mtm"] for r in rows if r["mtm"] is not None)
    n_mtm_none = sum(1 for r in rows if r["mtm"] is None)
    dp = res["daily_pnl"]
    print("\naggregate:")
    print(f"  sum ΔNPV (priceable rows)        = {agg_dnpv:,.2f}")
    print(f"  sum realized cash                = {agg_cash:,.2f}")
    print(f"  sum theta (all legs)             = {agg_theta:,.2f}")
    print(f"  sum mtm (known legs)             = {agg_mtm_known:,.2f}  ({n_mtm_none} legs mtm=None)")
    print(f"  reported daily_pnl.total         = {dp['total']:,.2f}")
    print(f"  reported daily_pnl.theta         = {dp['theta']:,.2f}")
    print(f"  reported daily_pnl.mtm           = {dp['mtm'] if dp['mtm'] is not None else '—'}")
    print(f"  reported mtm_complete            = {dp['mtm_complete']}")
    print(f"  aggregate resid (ΔNPV+cash − (mtm+theta known)) = "
          f"{agg_dnpv + agg_cash - (agg_mtm_known + agg_theta):,.4f}")

    out_path = Path(__file__).with_name("s11_identity_diag.json")
    out_path.write_text(json.dumps({
        "pair": [close_date.isoformat(), as_of.isoformat()],
        "rows": rows, "daily_pnl": dp,
    }, default=str, indent=1), encoding="utf-8")
    print(f"\nfull dump -> {out_path}")


if __name__ == "__main__":
    main()
