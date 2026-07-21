"""DV01-FIX Phase A — the value ledger (old→new) + acceptance evidence.

Service-level, real Data/, no server. For 2026-07-14 (recon date) and
2026-07-16 (latest close / panel headline):
  OLD  = the pre-fix aggregation replicated exactly (workbook pvbp at the
         stale sheet bucket) — byte-equivalent to e022ccc's bond loop;
  NEW  = the live build_pvbp_sensitivity (reval + FRN carve-out + fallback).
Prints per-sector totals old→new, the grand total, source counts, FRN rows,
blotter_as_of — and the acceptance ladder: bond 잔차 with the NEW M1 on
07-14→07-15 (target ≈ −72.9M per the diagnosis' like-for-like convention).
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import bond_valuation
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import credit_curve_service, market_data_service
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services.bond_risk import payment_frequency_for

DATES = [date(2026, 7, 14), date(2026, 7, 16)]
_TENORS = pas._TENOR_COLUMNS


def positions() -> list[pas.PositionData]:
    out = []
    for r in portfolio_loader.parse(DATA_DIR):
        out.append(
            pas.PositionData(
                instrument_type=r["instrument_type"],
                position_id=r["position_id"],
                sector=r["sector"],
                book=r["book"],
                start_date=r.get("start_date"),
                maturity_date=r.get("maturity_date"),
                notional=r.get("notional"),
                fixed_rate=r.get("fixed_rate"),
                pay_fixed=r.get("pay_fixed"),
                float_spread=r.get("float_spread"),
                evaluation_amount=r.get("evaluation_amount"),
                remaining_days=r.get("remaining_days"),
                tenor_bucket=r.get("tenor_bucket"),
                entry_yield=r.get("entry_yield"),
                mtm_yield=r.get("mtm_yield"),
                duration=r.get("duration"),
                pvbp=r.get("pvbp"),
                issue_date=r.get("issue_date"),
                coupon_rate=r.get("coupon_rate"),
                payment_frequency=r.get("payment_frequency"),
                rating=r.get("rating"),
            )
        )
    return out


def old_bond_rows(bonds: list[pas.PositionData]) -> dict[str, dict[str, float]]:
    rows: dict[str, dict[str, float]] = {}
    for b in bonds:
        rows.setdefault(b.sector, {c: 0.0 for c in _TENORS})
        if b.pvbp is not None and b.tenor_bucket in rows[b.sector]:
            rows[b.sector][b.tenor_bucket] += b.pvbp
    return rows


def main():
    pos = positions()
    bonds = [p for p in pos if p.instrument_type == "bond"]

    for d in DATES:
        snap = market_data_service.load_snapshot(d)
        new_rows = pas.build_pvbp_sensitivity(bonds, snap, {})  # bonds only: swap legs unchanged by DV01-FIX
        old = old_bond_rows(bonds)
        print(f"\n=== {d} — bond-side sector totals, OLD → NEW [CHANGED, DV01-A] ===")
        old_total = 0.0
        new_total = 0.0
        for row in new_rows:
            sec = row["sector"]
            if sec == "합계":
                continue
            o = sum(old.get(sec, {}).values())
            n = row["total"]
            old_total += o
            new_total += n
            print(f"  {sec}: {o:,.0f} -> {n:,.0f}  ({(n/o - 1)*100 if o else 0:+.1f}%)  sources={row.get('dv01_sources')}")
        print(f"  BOND GRAND TOTAL: {old_total:,.0f} -> {new_total:,.0f}  (x{new_total/old_total:.4f})")
        total_row = new_rows[-1]
        print(f"  blotter_as_of={total_row.get('blotter_as_of')}  frn={total_row.get('frn_positions')}")

    # ---- acceptance: bond 잔차 with the NEW service M1, 07-14 -> 07-15 -----
    d0, d1 = date(2026, 7, 14), date(2026, 7, 15)
    s0 = market_data_service.load_snapshot(d0)
    s1 = market_data_service.load_snapshot(d1)

    def pillar_rates(snap):
        rates = {}
        if snap.on_rate is not None:
            rates["1D"] = snap.on_rate
        rates["3M"] = snap.cd_rate
        for q in snap.swap_quotes:
            tm = getattr(q, "tenor_months", None)
            if tm == 6:
                rates["6M"] = q.rate
            elif tm == 9:
                rates["9M"] = q.rate
            elif tm == 18:
                rates["1.5Y"] = q.rate
            elif tm is None and 1 <= q.tenor_years <= 10:
                rates[f"{q.tenor_years}Y"] = q.rate
            elif tm is None and q.tenor_years == 30:
                rates["30Y"] = q.rate
        return rates

    p0, p1 = pillar_rates(s0), pillar_rates(s1)
    delta_bp = {c: (p1[c] - p0[c]) * 10000 for c in p0 if c in p1}

    m1 = pas.build_pvbp_sensitivity(bonds, s0, {})
    assumed_new = 0.0
    for row in m1:
        if row["sector"] == "합계":
            continue
        for c in _TENORS:
            dbp = delta_bp.get(c)
            if dbp is not None:
                assumed_new += row[c] * -dbp

    realized = 0.0
    n = 0
    for b in bonds:
        yrs1 = (b.maturity_date - d1).days / 365.0 if b.maturity_date else 0
        if yrs1 <= 0 or b.coupon_rate is None or not b.issue_date:
            continue
        try:
            y0 = credit_curve_service.market_yield_for(b.sector, b.rating, yrs1, d0)
            y1 = credit_curve_service.market_yield_for(b.sector, b.rating, yrs1, d1)
        except ValueError:
            continue
        f = payment_frequency_for(b.sector, b.payment_frequency)
        v = lambda y: bond_valuation.value_bond(
            asset_id=b.position_id, issue_date=b.issue_date, maturity_date=b.maturity_date,
            coupon_rate=b.coupon_rate, payment_frequency=f, notional=b.notional or 0.0,
            market_yield=y, val_date=d1,
        ).npv
        realized += v(y1) - v(y0)
        n += 1

    print(f"\n=== ACCEPTANCE (07-14 -> 07-15, bond leg, {n} revaluable) ===")
    print(f"  realized bond MtM:            {realized:,.0f}")
    print(f"  assumed (NEW service M1):     {assumed_new:,.0f}")
    print(f"  bond 잔차 (realized-assumed): {realized - assumed_new:,.0f}   [target ~ -72.9M]")


if __name__ == "__main__":
    main()
