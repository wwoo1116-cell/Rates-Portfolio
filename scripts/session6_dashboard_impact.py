"""
Session 6, Task 4 -- dashboard impact capture.

Computes every dashboard figure the IRS valuation fix can touch, off the
standard workbook seed (Data/Portfolio Data.xlsx through loaders/portfolio.py,
the same parser the upload page uses), headlessly and deterministically:

  1. book-level IRS MtM levels (clean/dirty NPV at the close snapshot)
  2. /api/portfolio/book-daily-pnl  (daily PnL, MtM/Theta split, by book)
  3. /api/portfolio/book-summary    (hedged duration per book + ribbon KPIs)
  4. /api/portfolio/pvbp-sensitivity (full 16-column matrix, IRS + bond rows)
  5. decomposition identity checks (total == mtm + theta; telescoping vs an
     independent revaluation)

Run BEFORE the fix and AFTER the fix with different --tag values; the two
JSON dumps diff to exactly the valuation impact (same seed, same dates, same
code path shape).

Usage:
    python scripts/session6_dashboard_impact.py before
    python scripts/session6_dashboard_impact.py after
Writes scripts/session6_dashboard_<tag>.json (+ a readable .txt table).

MySQL is force-disabled (same guard as diag_pnl_trace.py); reads only the
Excel workbooks. curve_cache is installed exactly like app startup does.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from irs_pricer.services import market_data_service as mds

mds._db_market_data_unavailable = True  # never touch the DB

from irs_pricer.config import DATA_DIR
from irs_pricer.engine import curve_cache
from irs_pricer.engine.quant_engine import next_kr_business_day
from irs_pricer.loaders import portfolio as portfolio_loader
from irs_pricer.services import portfolio_analytics_service as pas
from irs_pricer.services import portfolio_service
from irs_pricer.services.portfolio_analytics_service import PositionData

curve_cache.install()

FUNDING_SPREAD_BP = 10.0  # dashboard default


def load_seed() -> list[PositionData]:
    rows = portfolio_loader.parse(DATA_DIR)
    fields = {f for f in PositionData.__dataclass_fields__}
    return [PositionData(**{k: v for k, v in r.items() if k in fields}) for r in rows]


def pick_close_date() -> tuple[date, date]:
    """Latest available date whose next KR business day also has quotes --
    gives a (close, as_of) pair where the MtM leg is computable, matching the
    dashboard's state on a normal morning."""
    avail = mds.list_available_dates()
    avail_set = set(avail)
    for d in reversed(avail):
        nxt = next_kr_business_day(d)
        if nxt in avail_set:
            return d, nxt
    raise SystemExit("no adjacent business-day pair in the data")


def main() -> None:
    tag = sys.argv[1] if len(sys.argv) > 1 else "before"
    positions = load_seed()
    irs = [p for p in positions if p.instrument_type == "irs"]
    bonds = [p for p in positions if p.instrument_type == "bond"]

    close_date, as_of = pick_close_date()
    snapshot = mds.load_snapshot(close_date)
    fixings = mds.load_fixings()

    out: dict = {
        "tag": tag,
        "seed": {"n_positions": len(positions), "n_irs": len(irs), "n_bonds": len(bonds)},
        "close_date": close_date.isoformat(),
        "as_of": as_of.isoformat(),
    }

    # ── 1. book-level IRS MtM levels at the close snapshot ─────────────────
    swaps = [pas._to_swap(p) for p in irs]
    res_close = portfolio_service.price_portfolio(snapshot, swaps, fixings)
    by_book: dict[str, dict[str, float]] = {}
    for p, r in zip(irs, res_close.position_results):
        b = by_book.setdefault(p.book, {"clean_npv": 0.0, "dirty_npv": 0.0, "n": 0})
        b["clean_npv"] += r.clean_npv
        b["dirty_npv"] += r.dirty_npv
        b["n"] += 1
    out["irs_mtm_by_book"] = {
        k: {"clean_npv": v["clean_npv"], "dirty_npv": v["dirty_npv"], "n": v["n"]}
        for k, v in sorted(by_book.items())
    }
    out["irs_mtm_total"] = {
        "clean_npv": sum(v["clean_npv"] for v in by_book.values()),
        "dirty_npv": sum(v["dirty_npv"] for v in by_book.values()),
        "net_npv": res_close.net_npv,
        "payer_npv": res_close.payer_npv,
        "receiver_npv": res_close.receiver_npv,
    }

    # ── 2. daily PnL (MtM/Theta split) ──────────────────────────────────────
    daily = pas.build_book_daily_pnl(positions, snapshot, fixings, FUNDING_SPREAD_BP)
    out["book_daily_pnl"] = daily

    # identity check: every row's total == theta + (mtm or 0)
    identity = []
    for row in daily["by_book"]:
        gap = row["total"] - (row["theta"] + (row["mtm"] or 0.0))
        identity.append({"book": row["book"], "total_minus_mtm_theta": gap})
    out["identity_rows"] = identity

    # telescoping check, IRS only, against an independent revaluation:
    # theta + mtm must equal V(T, c_T) - V(close, c_close) + realized cash.
    rolled = pas._roll_quotes_to(snapshot, as_of)
    today_snapshot = mds.load_snapshot(as_of)
    legs, _ = pas._swap_pnl(irs, snapshot, rolled, today_snapshot, fixings)
    v_close = [r.clean_npv for r in res_close.position_results]
    res_today = portfolio_service.price_portfolio(
        pas._roll_quotes_to(today_snapshot, as_of), swaps, fixings
    )
    v_today = [r.clean_npv for r in res_today.position_results]
    cash = pas._realized_swap_cash(irs, res_close.cashflows, close_date, as_of)
    max_gap = 0.0
    for leg, vc, vt, c in zip(legs, v_close, v_today, cash):
        lhs = leg.theta + (leg.mtm or 0.0)
        rhs = vt - vc + c
        max_gap = max(max_gap, abs(lhs - rhs))
    out["telescoping_max_abs_gap_krw"] = max_gap
    out["irs_daily_legs_totals"] = {
        "theta": sum(l.theta for l in legs),
        "mtm": sum((l.mtm or 0.0) for l in legs),
        "n_mtm_none": sum(1 for l in legs if l.mtm is None),
    }

    # ── 3. book summary: ribbon KPIs + hedged duration ─────────────────────
    summary = pas.build_book_summary(positions, snapshot, fixings)
    out["book_summary"] = [
        {
            "book": row.get("book"),
            "total_notional": row.get("totalNotional"),
            "total_eval_amt": row.get("totalEvaluationAmount"),
            "weighted_ytm": row.get("weightedAvgYTM"),
            "hedged_duration": row.get("hedgedDuration"),
        }
        for row in summary
    ]

    # ── 4. PVBP sensitivity matrix (all 16 columns) ─────────────────────────
    pvbp = pas.build_pvbp_sensitivity(positions, snapshot, fixings)
    out["pvbp_matrix"] = pvbp

    dst = Path(__file__).resolve().parent / f"session6_dashboard_{tag}.json"
    dst.write_text(json.dumps(out, indent=2, ensure_ascii=False, default=str), encoding="utf-8")

    # readable summary
    lines = [f"== session6 dashboard capture [{tag}] close={close_date} as_of={as_of} =="]
    lines.append(f"seed: {len(positions)} positions ({len(irs)} IRS, {len(bonds)} bonds)")
    t = out["irs_mtm_total"]
    lines.append(f"IRS MtM total: clean={t['clean_npv']:,.0f}  dirty={t['dirty_npv']:,.0f}")
    for k, v in out["irs_mtm_by_book"].items():
        lines.append(f"  [{k}] clean={v['clean_npv']:,.0f} dirty={v['dirty_npv']:,.0f} (n={v['n']})")
    d = daily["daily_pnl"]
    lines.append(
        f"daily_pnl: total={d['total']:,.0f} mtm={d['mtm'] if d['mtm'] is None else format(d['mtm'], ',.0f')} "
        f"theta={d['theta']:,.0f} complete={d['mtm_complete']}"
    )
    for row in daily["by_book"]:
        mtm = "None" if row["mtm"] is None else f"{row['mtm']:,.0f}"
        lines.append(
            f"  [{row['book']}] total={row['total']:,.0f} mtm={mtm} theta={row['theta']:,.0f} "
            f"funding={row['funding']:,.0f}"
        )
    lines.append(f"telescoping max |gap| = {max_gap:.6f} KRW")
    for row in out["book_summary"]:
        lines.append(
            f"summary [{row['book']}]: eval={row['total_eval_amt'] or 0:,.0f} "
            f"ytm={row['weighted_ytm'] or 0:.4f} hedged_dur={row['hedged_duration'] or 0:.4f}"
        )
    for row in pvbp:
        cells = "  ".join(f"{c}={row[c]:,.1f}" for c in pas._TENOR_COLUMNS if abs(row.get(c, 0.0)) > 1e-9)
        lines.append(f"pvbp [{row['sector']}] total={row['total']:,.1f}  {cells}")
    txt = "\n".join(lines) + "\n"
    (Path(__file__).resolve().parent / f"session6_dashboard_{tag}.txt").write_text(txt, encoding="utf-8")
    print(txt)


if __name__ == "__main__":
    main()
