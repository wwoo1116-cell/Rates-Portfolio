"""DV01-DIAG Phase 1 — workbook bond PVBP vs bump-reval DV01, per-bond.

Read-only: real workbook via the existing loader, real Data/ store, direct
module calls (no server). For each schedulable bond on each testable date:

    ratio_i = workbook_PVBP_i / bump_reval_DV01_i

with the discriminators:
  H-scale : ratio ~ uniform constant (loader/unit bug)
  H-basis : ratio varies with duration/coupon/price; a named convention must
            REPRODUCE the workbook number
  H-data  : neither reproduces (vendor error)

Extra discriminators wired in:
  - column identity: workbook pvbp vs 듀레이션×평가금액/1e4 (the loader's own
    fallback formula) — is the sheet column literally that product?
  - stale duration: count(듀레이션 > remaining_years) — Macaulay duration can
    NEVER exceed remaining maturity; any violation = the column predates the
    current remaining term (or is a different measure entirely).
  - implied duration: dv01_reval×1e4 / dirty_value vs the sheet column.
  - modified-duration candidates: 듀레이션/(1+y/m) for m∈{1,2,4}.

Plus the acceptance cross-check: the daily-recon bond 잔차 recomputed with
reval DV01 in M1 (bucketed like build_pvbp_sensitivity, swap-pillar Δbp,
sign KRD×(−Δbp)) vs the workbook-PVBP version.
"""
from __future__ import annotations

import statistics
import sys
from datetime import date
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import bond_valuation
from irs_pricer.engine.quant_engine import next_kr_business_day
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import market_data_service as mds
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services.portfolio_analytics_service import PositionData

CLOSES = [date(2026, 7, 14), date(2026, 7, 15)]
BUMP = 0.00005  # ±0.5bp

# FE pillar map transcription (daily-recon-math.pillarRates)
def pillar_rates(snap) -> dict[str, float]:
    rates: dict[str, float] = {}
    if snap.on_rate is not None:
        rates["1D"] = snap.on_rate
    rates["3M"] = snap.cd_rate
    for q in snap.swap_quotes:
        tm = getattr(q, "tenor_months", None)
        ty = getattr(q, "tenor_years", None)
        if tm is not None:
            if tm == 6: rates["6M"] = q.rate
            elif tm == 9: rates["9M"] = q.rate
            elif tm == 18: rates["1.5Y"] = q.rate
        elif ty is not None and 1 <= ty <= 10:
            rates[f"{int(ty)}Y"] = q.rate
        elif ty == 30:
            rates["30Y"] = q.rate
    return rates


def load_bonds() -> list[PositionData]:
    raw = portfolio_loader.parse(DATA_DIR)
    out = []
    for p in raw:
        if p["instrument_type"] != "bond":
            continue
        freq = p.get("payment_frequency")
        if freq is None:
            freq = 2 if p["sector"] in ("국고채", "통안채") else 4
        kw = {k: v for k, v in p.items() if k in PositionData.__dataclass_fields__}
        kw["payment_frequency"] = freq
        out.append(PositionData(**kw))
    return out


def value(p: PositionData, y: float, val_date: date) -> float:
    return bond_valuation.value_bond(
        asset_id=p.position_id, issue_date=p.issue_date, maturity_date=p.maturity_date,
        coupon_rate=p.coupon_rate, payment_frequency=p.payment_frequency,
        notional=p.notional or 0.0, market_yield=y, val_date=val_date,
    ).npv


def corr(xs: list[float], ys: list[float]) -> float:
    if len(xs) < 3:
        return float("nan")
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sx = sum((x - mx) ** 2 for x in xs) ** 0.5
    sy = sum((y - my) ** 2 for y in ys) ** 0.5
    if sx == 0 or sy == 0:
        return float("nan")
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy)


def run_date(close: date, bonds: list[PositionData]) -> None:
    print("\n" + "=" * 76)
    print(f"close={close}")
    snap_close = mds.load_snapshot(close)

    rows = []
    stale_violations = 0
    for p in bonds:
        if not (p.issue_date and p.maturity_date and p.coupon_rate is not None and p.payment_frequency):
            continue
        try:
            y0 = pas._bond_market_yield(p, close, p.maturity_date)
        except ValueError:
            continue
        v0 = value(p, y0, close)
        dv01 = (value(p, y0 - BUMP, close) - value(p, y0 + BUMP, close))  # per 1bp
        if dv01 <= 0 or not p.pvbp:
            continue
        rem_years = (p.maturity_date - close).days / 365.0
        dur_col = p.duration or 0.0
        implied_dur = dv01 * 1e4 / v0 if v0 else float("nan")
        rows.append({
            "id": p.position_id, "sector": p.sector,
            "pvbp_wb": p.pvbp, "dv01": dv01, "ratio": p.pvbp / dv01,
            "dur_col": dur_col, "rem_years": rem_years, "implied_dur": implied_dur,
            "eval_amt": p.evaluation_amount or 0.0, "dirty": v0,
            "coupon": p.coupon_rate, "y0": y0,
            "fallback_pvbp": dur_col * (p.evaluation_amount or 0.0) / 1e4,
        })
        if dur_col > rem_years + 1e-9:
            stale_violations += 1

    ratios = [r["ratio"] for r in rows]
    print(f"bonds priced: {len(rows)}  |  ratio mean={statistics.fmean(ratios):.4f} "
          f"median={statistics.median(ratios):.4f} std={statistics.pstdev(ratios):.4f} "
          f"min={min(ratios):.4f} max={max(ratios):.4f}")
    print(f"  H-scale check: cv = {statistics.pstdev(ratios)/statistics.fmean(ratios):.3%} "
          f"(uniform ⇒ ~0)")
    print(f"  corr(ratio, rem_years) = {corr(ratios, [r['rem_years'] for r in rows]):+.3f}   "
          f"corr(ratio, dur_col) = {corr(ratios, [r['dur_col'] for r in rows]):+.3f}   "
          f"corr(ratio, coupon) = {corr(ratios, [r['coupon'] for r in rows]):+.3f}")

    # Column identity: is workbook pvbp ≡ 듀레이션×평가금액/1e4?
    ident = [abs(r["pvbp_wb"] - r["fallback_pvbp"]) / r["pvbp_wb"] for r in rows if r["pvbp_wb"]]
    n_ident = sum(1 for e in ident if e < 0.005)
    print(f"  column identity pvbp≈dur×eval/1e4 (<0.5% off): {n_ident}/{len(rows)}")

    # Stale-duration smoking gun: Macaulay can never exceed remaining term.
    print(f"  듀레이션 > remaining_years violations: {stale_violations}/{len(rows)}")
    dur_vs_impl = [r["dur_col"] / r["implied_dur"] for r in rows if r["implied_dur"] > 0]
    print(f"  dur_col / reval-implied-dur: mean={statistics.fmean(dur_vs_impl):.4f} "
          f"median={statistics.median(dur_vs_impl):.4f}")
    # eval vs dirty base
    eval_vs_dirty = [r["eval_amt"] / r["dirty"] for r in rows if r["dirty"]]
    print(f"  평가금액 / dirty_value: mean={statistics.fmean(eval_vs_dirty):.4f} "
          f"median={statistics.median(eval_vs_dirty):.4f}")

    # Modified-duration candidates
    for m in (1, 2, 4):
        cand = [r["dur_col"] / (1 + r["y0"] / m) * r["eval_amt"] / 1e4 / r["dv01"] for r in rows]
        print(f"  candidate ModDur(m={m})×eval/1e4 vs dv01: mean ratio {statistics.fmean(cand):.4f}")

    # Worst/representative rows
    rows.sort(key=lambda r: r["ratio"])
    print("  sample rows (id | sector | ratio | dur_col | rem_y | implied_dur | eval/dirty):")
    for r in rows[:3] + rows[len(rows)//2 - 1: len(rows)//2 + 2] + rows[-3:]:
        print(f"    {r['id'][:28]:28s} {r['sector']:4s} {r['ratio']:6.3f} {r['dur_col']:6.3f} "
              f"{r['rem_years']:6.3f} {r['implied_dur']:6.3f} {r['eval_amt']/r['dirty'] if r['dirty'] else float('nan'):8.4f}")

    # ── acceptance cross-check: bond 잔차 with reval DV01 in M1 ──
    as_of = next_kr_business_day(close)
    try:
        asof_snap = mds.load_snapshot(as_of)
    except Exception:
        print(f"  (no {as_of} snapshot — 잔차 cross-check skipped)")
        return
    r_close, r_asof = pillar_rates(snap_close), pillar_rates(asof_snap)
    dbp = {c: (r_asof[c] - r_close[c]) * 1e4 for c in r_close if c in r_asof}

    def bucket(p: PositionData) -> str:
        return p.tenor_bucket

    def assumed(get_krd) -> float:
        s = 0.0
        for r in rows:
            p = next(b for b in bonds if b.position_id == r["id"] and abs((b.pvbp or 0) - r["pvbp_wb"]) < 1e-6)
            d = dbp.get(bucket(p))
            if d is not None:
                s += get_krd(r) * -d
        return s

    a_wb = assumed(lambda r: r["pvbp_wb"])
    a_rv = assumed(lambda r: r["dv01"])

    daily = pas.build_book_daily_pnl(load_all(), snap_close, mds.load_fixings(), 10.0)
    total = next(b for b in daily["by_book"] if b["book"] == "Total")
    bond_mtm = total["by_class"]["bond"]["mtm"]
    if bond_mtm is None:
        print(f"  bond mtm None at {as_of} (source incomplete) — collapse check n/a on this date")
        return
    print(f"\n  [잔차 collapse] bond realized mtm = {bond_mtm/1e6:+,.1f}M")
    print(f"    Assumed(bond) workbook-PVBP grid = {a_wb/1e6:+,.1f}M → 잔차 {(bond_mtm - a_wb)/1e6:+,.1f}M")
    print(f"    Assumed(bond) reval-DV01 grid    = {a_rv/1e6:+,.1f}M → 잔차 {(bond_mtm - a_rv)/1e6:+,.1f}M")
    print(f"    (remaining gap ≈ the credit-vs-swap-pillar basis term)")


_ALL_CACHE: list[PositionData] | None = None

def load_all() -> list[PositionData]:
    global _ALL_CACHE
    if _ALL_CACHE is None:
        raw = portfolio_loader.parse(DATA_DIR)
        out = []
        for p in raw:
            freq = p.get("payment_frequency")
            if p["instrument_type"] == "bond" and freq is None:
                freq = 2 if p["sector"] in ("국고채", "통안채") else 4
            kw = {k: v for k, v in p.items() if k in PositionData.__dataclass_fields__}
            kw["payment_frequency"] = freq
            out.append(PositionData(**kw))
        _ALL_CACHE = out
    return _ALL_CACHE


def main() -> None:
    bonds = [p for p in load_all() if p.instrument_type == "bond"]
    print(f"workbook bonds: {len(bonds)}")
    for close in CLOSES:
        run_date(close, bonds)


if __name__ == "__main__":
    main()
