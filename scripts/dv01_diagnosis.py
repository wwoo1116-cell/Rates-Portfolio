"""DV01-DIAG Phase 1 — workbook bond PVBP vs bump-reval DV01, per-bond, both dates.

Read-only: loaders + engine module calls, no server, no writes to Data/.

Per bond i and date D:
    pvbp_wb_i  = the workbook-fed figure (loaders/portfolio.py: "Duration가중
                 평가액"/10000, else 듀레이션 × 평가금액 / 10000)
    dv01_rv_i  = central bump-reval on the engine's dirty NPV at the credit
                 curve yield: [V(y−0.5bp) − V(y+0.5bp)] / 1bp
    ratio_i    = pvbp_wb_i / dv01_rv_i

Decomposition (H-scale vs H-basis discriminator):
    ratio_i = (D_wb / D_mod) × (평가금액 / dirty)
with D_mod = engine Macaulay/(1+y/f) from the same cashflows — so a uniform
duration-factor names the duration column's convention, a uniform value-factor
names the value basis, and residual spread says H-data.

Also: the recon bond-잔차 collapse check — Assumed(bond) rebuilt with reval
DV01 per tenor bucket vs the realized bond MtM for D−1=2026-07-14 → D=07-15.
"""
from __future__ import annotations

import statistics
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import bond_valuation
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import credit_curve_service

BUMP = 0.00005  # 0.5bp central

DATES = [date(2026, 7, 14), date(2026, 7, 15)]


def payment_frequency_for(sector: str) -> int:
    # The FE convention (upload page / blotter-parser): 국고/통안 = 2, else 4.
    return 2 if sector in ("국고채", "통안채") else 4


def load_bonds() -> list[dict]:
    rows = portfolio_loader.parse(DATA_DIR)
    return [
        r
        for r in rows
        if r["instrument_type"] == "bond"
        and r.get("issue_date")
        and r.get("maturity_date")
        and r.get("coupon_rate") is not None
        and r.get("pvbp")
    ]


def engine_valuation(b: dict, y: float, d: date):
    return bond_valuation.value_bond(
        asset_id=b["position_id"],
        issue_date=b["issue_date"],
        maturity_date=b["maturity_date"],
        coupon_rate=b["coupon_rate"],
        payment_frequency=payment_frequency_for(b["sector"]),
        notional=b["notional"],
        market_yield=y,
        val_date=d,
    )


def macaulay(val, y: float, f: float, d: date) -> float:
    num = 0.0
    for cf in val.cashflows:
        t = (cf.payment_date - d).days / 365.0
        num += t * cf.pv
    return num / val.npv if val.npv else 0.0


def analyze(d: date, bonds: list[dict]):
    rows = []
    skipped = 0
    for b in bonds:
        years = max((b["maturity_date"] - d).days / 365.0, 0.0)
        if years <= 0:
            skipped += 1
            continue
        try:
            y = credit_curve_service.market_yield_for(b["sector"], b["rating"], years, d)
        except ValueError:
            skipped += 1
            continue
        f = float(payment_frequency_for(b["sector"]))
        base = engine_valuation(b, y, d)
        up = engine_valuation(b, y + BUMP, d)
        dn = engine_valuation(b, y - BUMP, d)
        dv01 = (dn.npv - up.npv) / 1.0  # per 1bp (bumps are ±0.5bp)
        if dv01 <= 0:
            skipped += 1
            continue
        d_mac = macaulay(base, y, f, d)
        d_mod = d_mac / (1.0 + y / f)
        ratio = b["pvbp"] / dv01
        dur_factor = (b["duration"] / d_mod) if d_mod else float("nan")
        val_factor = (b["evaluation_amount"] / base.npv) if base.npv else float("nan")
        rows.append(
            {
                "id": b["position_id"],
                "sector": b["sector"],
                "years": years,
                "coupon": b["coupon_rate"],
                "y": y,
                "pvbp_wb": b["pvbp"],
                "dv01_rv": dv01,
                "ratio": ratio,
                "dur_wb": b["duration"],
                "d_mac": d_mac,
                "d_mod": d_mod,
                "dur_factor": dur_factor,
                "val_factor": val_factor,
                "eval_amt": b["evaluation_amount"],
                "dirty": base.npv,
            }
        )
    return rows, skipped


def stats(name: str, xs: list[float]):
    xs = [x for x in xs if x == x]  # drop NaN
    if not xs:
        print(f"  {name}: (empty)")
        return
    q = statistics.quantiles(xs, n=4)
    print(
        f"  {name}: n={len(xs)} mean={statistics.fmean(xs):.4f} "
        f"median={statistics.median(xs):.4f} sd={statistics.pstdev(xs):.4f} "
        f"q1={q[0]:.4f} q3={q[2]:.4f} min={min(xs):.4f} max={max(xs):.4f}"
    )


def corr(xs: list[float], ys: list[float]) -> float:
    xs2 = [(x, y) for x, y in zip(xs, ys) if x == x and y == y]
    if len(xs2) < 3:
        return float("nan")
    return statistics.correlation([a for a, _ in xs2], [b for _, b in xs2])


def main():
    bonds = load_bonds()
    print(f"bonds with full static params + pvbp: {len(bonds)}")

    for d in DATES:
        rows, skipped = analyze(d, bonds)
        print(f"\n=== {d} (analyzed {len(rows)}, skipped {skipped}) ===")
        stats("ratio pvbp_wb/dv01_reval", [r["ratio"] for r in rows])
        stats("duration factor D_wb/D_mod", [r["dur_factor"] for r in rows])
        stats("value factor 평가금액/dirty", [r["val_factor"] for r in rows])
        stats("D_wb/D_mac", [r["dur_wb"] / r["d_mac"] for r in rows if r["d_mac"]])
        print("  corr(ratio, years):", f"{corr([r['ratio'] for r in rows], [r['years'] for r in rows]):.4f}")
        print("  corr(ratio, coupon):", f"{corr([r['ratio'] for r in rows], [r['coupon'] for r in rows]):.4f}")
        print("  corr(ratio, y):", f"{corr([r['ratio'] for r in rows], [r['y'] for r in rows]):.4f}")
        # Per-sector medians (H-scale should be flat across sectors too).
        by_sector: dict[str, list[float]] = {}
        for r in rows:
            by_sector.setdefault(r["sector"], []).append(r["ratio"])
        for s, xs in sorted(by_sector.items()):
            print(f"    sector {s}: n={len(xs)} median={statistics.median(xs):.4f}")
        # Ratio vs maturity band — the H-basis fingerprint if it slopes.
        bands = [(0, 1), (1, 3), (3, 5), (5, 10), (10, 40)]
        for lo, hi in bands:
            xs = [r["ratio"] for r in rows if lo <= r["years"] < hi]
            if xs:
                print(f"    band {lo}-{hi}y: n={len(xs)} median={statistics.median(xs):.4f}")
        # Three hand-check bonds spread over maturity for the closed-form check.
        picked = sorted(rows, key=lambda r: r["years"])
        for r in [picked[0], picked[len(picked) // 2], picked[-1]]:
            print(
                f"    HAND {r['id'][:24]:24s} {r['sector']} yrs={r['years']:.2f} "
                f"cpn={r['coupon']:.3f} y={r['y']*100:.3f}% dur_wb={r['dur_wb']:.4f} "
                f"D_mac={r['d_mac']:.4f} D_mod={r['d_mod']:.4f} eval={r['eval_amt']:.0f} "
                f"dirty={r['dirty']:.0f} pvbp_wb={r['pvbp_wb']:.0f} dv01_rv={r['dv01_rv']:.0f} "
                f"ratio={r['ratio']:.4f}"
            )


if __name__ == "__main__":
    main()
