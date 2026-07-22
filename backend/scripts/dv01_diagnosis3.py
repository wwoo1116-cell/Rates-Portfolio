"""DV01-DIAG Phase 1c — the bond-잔차 collapse check (acceptance evidence).

Recon window D−1 = 2026-07-14 → D = 2026-07-15, bond leg only, service-level:
    realized_i = V(D, y_D) − V(D, y_{D−1})                (the _bond_pnl mtm)
    assumed_wb = Σ pvbp_workbook_i × (−Δbp[stale bucket])  (today's live M1)
    assumed_rv = Σ dv01_reval_i    × (−Δbp[fresh bucket])  (option A's M1)
    잔차 = realized − assumed, both ways.
Does reval DV01 collapse the bond 잔차 the way the swap side collapsed to −1.7M?
"""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import bond_valuation
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.loaders.portfolio import _bucket_for_years
from irs_pricer.services import credit_curve_service, market_data_service

D0 = date(2026, 7, 14)
D1 = date(2026, 7, 15)


def payment_frequency_for(sector: str) -> int:
    return 2 if sector in ("국고채", "통안채") else 4


def pillar_rates(snap) -> dict[str, float]:
    rates: dict[str, float] = {}
    if snap.on_rate is not None:
        rates["1D"] = snap.on_rate
    rates["3M"] = snap.cd_rate
    for q in snap.swap_quotes:
        tm = getattr(q, "tenor_months", None)
        if tm is not None:
            if tm == 6:
                rates["6M"] = q.rate
            elif tm == 9:
                rates["9M"] = q.rate
            elif tm == 18:
                rates["1.5Y"] = q.rate
        elif 1 <= q.tenor_years <= 10:
            rates[f"{q.tenor_years}Y"] = q.rate
        elif q.tenor_years == 30:
            rates["30Y"] = q.rate
    return rates


def value(b, y, d):
    return bond_valuation.value_bond(
        asset_id=b["position_id"], issue_date=b["issue_date"],
        maturity_date=b["maturity_date"], coupon_rate=b["coupon_rate"],
        payment_frequency=payment_frequency_for(b["sector"]), notional=b["notional"],
        market_yield=y, val_date=d,
    ).npv


def main():
    s0 = market_data_service.load_snapshot(D0)
    s1 = market_data_service.load_snapshot(D1)
    p0, p1 = pillar_rates(s0), pillar_rates(s1)
    delta_bp = {c: (p1[c] - p0[c]) * 10000 for c in p0 if c in p1}

    bonds = [
        r for r in portfolio_loader.parse(DATA_DIR)
        if r["instrument_type"] == "bond" and r.get("issue_date") and r.get("maturity_date")
        and r.get("coupon_rate") is not None and r.get("pvbp")
    ]

    realized = 0.0
    assumed_wb = 0.0
    assumed_rv = 0.0
    n = 0
    skipped_curve = 0
    skipped_pillar_wb = 0
    skipped_pillar_rv = 0
    for b in bonds:
        yrs1 = (b["maturity_date"] - D1).days / 365.0
        if yrs1 <= 0:
            continue
        try:
            y0 = credit_curve_service.market_yield_for(b["sector"], b["rating"], yrs1, D0)
            y1 = credit_curve_service.market_yield_for(b["sector"], b["rating"], yrs1, D1)
        except ValueError:
            skipped_curve += 1
            continue
        realized += value(b, y1, D1) - value(b, y0, D1)
        n += 1

        # live M1 leg: workbook pvbp × (−Δbp at the STALE parsed bucket)
        d_wb = delta_bp.get(b["tenor_bucket"])
        if d_wb is None:
            skipped_pillar_wb += 1
        else:
            assumed_wb += b["pvbp"] * -d_wb

        # option-A leg: bump-reval dv01 × (−Δbp at the FRESH bucket)
        yrs0 = (b["maturity_date"] - D0).days / 365.0
        try:
            yb = credit_curve_service.market_yield_for(b["sector"], b["rating"], yrs0, D0)
        except ValueError:
            skipped_pillar_rv += 1
            continue
        dv01 = (value(b, yb - 0.00005, D0) - value(b, yb + 0.00005, D0))
        d_rv = delta_bp.get(_bucket_for_years(yrs0))
        if d_rv is None:
            skipped_pillar_rv += 1
        else:
            assumed_rv += dv01 * -d_rv

    print(f"bonds in window: {n} (curve-skips {skipped_curve}; pillar-skips wb {skipped_pillar_wb} / rv {skipped_pillar_rv})")
    print(f"realized bond MtM (07-14 -> 07-15): {realized:,.0f}")
    print(f"assumed WORKBOOK (live M1):         {assumed_wb:,.0f}   bond-잔차 = {realized - assumed_wb:,.0f}")
    print(f"assumed REVAL-DV01 (option A):      {assumed_rv:,.0f}   bond-잔차 = {realized - assumed_rv:,.0f}")


if __name__ == "__main__":
    main()
