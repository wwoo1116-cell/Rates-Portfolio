"""DV01-DIAG Phase 1b — discriminate the stale-as-of hypothesis.

For each bond: solve the lag s (calendar days) such that the ENGINE's
Macaulay duration valued at (D − s) matches the workbook 듀레이션. A tight
s-cluster ⇒ one frozen as-of date for the whole column. Cross-checks:
  - 잔존일수 offset: parsed remaining_days − (maturity − D).days per bond
    (is the whole workbook snapshot dated, not just duration?)
  - mass-weighted aggregate Σpvbp_wb / Σdv01_reval (the panel's headline
    overstatement — the ledger's "~42%").
"""
from __future__ import annotations

import statistics
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import bond_valuation
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import credit_curve_service

D = date(2026, 7, 14)


def payment_frequency_for(sector: str) -> int:
    return 2 if sector in ("국고채", "통안채") else 4


def macaulay_at(b: dict, y: float, d: date) -> float | None:
    if (b["maturity_date"] - d).days <= 0:
        return None
    val = bond_valuation.value_bond(
        asset_id=b["position_id"],
        issue_date=b["issue_date"],
        maturity_date=b["maturity_date"],
        coupon_rate=b["coupon_rate"],
        payment_frequency=payment_frequency_for(b["sector"]),
        notional=b["notional"],
        market_yield=y,
        val_date=d,
    )
    if not val.npv:
        return None
    num = sum(((cf.payment_date - d).days / 365.0) * cf.pv for cf in val.cashflows)
    return num / val.npv


def main():
    rows = [
        r
        for r in portfolio_loader.parse(DATA_DIR)
        if r["instrument_type"] == "bond"
        and r.get("issue_date")
        and r.get("maturity_date")
        and r.get("coupon_rate") is not None
        and r.get("pvbp")
    ]

    lags = []
    rem_offsets = []
    agg_pvbp = 0.0
    agg_dv01 = 0.0
    unsolved = 0
    for b in rows:
        years = max((b["maturity_date"] - D).days / 365.0, 0.0)
        if years <= 0:
            continue
        rem_offsets.append(b["remaining_days"] - (b["maturity_date"] - D).days)
        try:
            y = credit_curve_service.market_yield_for(b["sector"], b["rating"], years, D)
        except ValueError:
            continue
        # aggregate ratio (panel headline)
        f = float(payment_frequency_for(b["sector"]))
        up = bond_valuation.value_bond(
            asset_id=b["position_id"], issue_date=b["issue_date"],
            maturity_date=b["maturity_date"], coupon_rate=b["coupon_rate"],
            payment_frequency=int(f), notional=b["notional"],
            market_yield=y + 0.00005, val_date=D,
        ).npv
        dn = bond_valuation.value_bond(
            asset_id=b["position_id"], issue_date=b["issue_date"],
            maturity_date=b["maturity_date"], coupon_rate=b["coupon_rate"],
            payment_frequency=int(f), notional=b["notional"],
            market_yield=y - 0.00005, val_date=D,
        ).npv
        dv01 = dn - up
        if dv01 > 0:
            agg_pvbp += b["pvbp"]
            agg_dv01 += dv01

        # solve lag: binary search s in [0, 500] days on monotone D_mac(D−s)
        target = b["duration"]
        lo, hi = 0, 500
        d_lo = macaulay_at(b, y, D - timedelta(days=lo))
        d_hi = macaulay_at(b, y, D - timedelta(days=hi))
        if d_lo is None or d_hi is None or not (d_lo <= target <= d_hi):
            unsolved += 1
            continue
        for _ in range(24):
            mid = (lo + hi) / 2
            dm = macaulay_at(b, y, D - timedelta(days=mid))
            if dm is None:
                break
            if dm < target:
                lo = mid
            else:
                hi = mid
        lags.append((lo + hi) / 2)

    print(f"bonds: {len(rows)}  lag-solved: {len(lags)}  unsolved(out-of-range): {unsolved}")
    if lags:
        q = statistics.quantiles(lags, n=4)
        print(
            f"implied stale-lag days: mean={statistics.fmean(lags):.1f} "
            f"median={statistics.median(lags):.1f} sd={statistics.pstdev(lags):.1f} "
            f"q1={q[0]:.1f} q3={q[2]:.1f} min={min(lags):.1f} max={max(lags):.1f}"
        )
        med = statistics.median(lags)
        print(f"implied workbook duration as-of ~= {D - timedelta(days=round(med))}")
        within = sum(1 for s in lags if abs(s - med) <= 15)
        print(f"within ±15d of median: {within}/{len(lags)} = {within/len(lags)*100:.1f}%")
    if rem_offsets:
        print(
            f"잔존일수 offset vs (maturity − {D}): median={statistics.median(rem_offsets)} "
            f"min={min(rem_offsets)} max={max(rem_offsets)} "
            f"(all-equal → whole snapshot single-dated)"
        )
        from collections import Counter
        print("  top offsets:", Counter(rem_offsets).most_common(5))
    if agg_dv01:
        print(f"AGGREGATE Σpvbp_wb/Σdv01_reval = {agg_pvbp/agg_dv01:.4f}  (panel headline factor)")


if __name__ == "__main__":
    main()
