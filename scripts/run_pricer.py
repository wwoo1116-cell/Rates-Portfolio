"""
KRW IRS Pricer -- CSV-based NPV calculator.

Usage examples:
  python scripts/run_pricer.py                              # latest date, show par table
  python scripts/run_pricer.py --date 2026-06-26            # specific date
  python scripts/run_pricer.py --date 2026-06-26 --tenor 3 --notional 10000000000 --fixed-rate 3.51
  python scripts/run_pricer.py --date 2026-06-26 --tenor 5 --notional 10000000000 --receiver

The --fixed-rate flag accepts a percentage (e.g. 3.51 means 3.51%).
Omitting --fixed-rate prices the swap at the market par rate (NPV = 0 by construction).
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

from dateutil.relativedelta import relativedelta

from irs_pricer import MarketSnapshot, RateQuote
from irs_pricer.config import DATA_DIR
from irs_pricer.core.errors import NonBusinessDayError
from irs_pricer.engine.instruments import VanillaSwap
from irs_pricer.loaders.factory import latest_common_date, load_market_snapshot

_TENORS = [1, 2, 3, 5, 7, 10]


def _fmt_rate(r: float) -> str:
    return f"{r * 100:.4f}%"


def _fmt_npv(v: float) -> str:
    return f"{v:,.0f}"


def print_market_data(snapshot: MarketSnapshot) -> None:
    print(f"\n{'-' * 48}")
    print(f"  Valuation date : {snapshot.valuation_date}")
    print(f"  CD 91D         : {_fmt_rate(snapshot.cd_rate)}")
    print(f"  IRS par quotes :")
    for q in sorted(snapshot.swap_quotes, key=lambda x: x.tenor_years):
        print(f"    {q.tenor_years:>2}Y  {_fmt_rate(q.rate)}")
    print(f"{'-' * 48}")


def print_par_table(snapshot: MarketSnapshot) -> None:
    from irs_pricer.services.pricing_service import price

    print(f"\n  {'Tenor':>5}  {'Par Rate':>10}  {'DV01 (KRW 1bn)':>16}")
    print(f"  {'-'*5}  {'-'*10}  {'-'*16}")
    for q in sorted(snapshot.swap_quotes, key=lambda x: x.tenor_years):
        swap = VanillaSwap(
            tenor_years=q.tenor_years,
            notional=1_000_000_000,
            fixed_rate=q.rate,
            pay_fixed=True,
        )
        result = price(snapshot, swap)
        d = result["dv01"]
        print(f"  {q.tenor_years:>4}Y  {_fmt_rate(result['par_rate']):>10}  {d:>16,.0f}")


def price_single(
    snapshot: MarketSnapshot,
    tenor: int,
    notional: float,
    fixed_rate: float | None,
    pay_fixed: bool,
) -> dict:
    from irs_pricer.services.pricing_service import price

    if fixed_rate is None:
        par_swap = VanillaSwap(tenor_years=tenor, notional=notional, fixed_rate=0.0, pay_fixed=pay_fixed)
        fixed_rate = price(snapshot, par_swap)["par_rate"]
        print(f"\n  --fixed-rate not supplied; using market par rate {_fmt_rate(fixed_rate)}")

    swap = VanillaSwap(tenor_years=tenor, notional=notional, fixed_rate=fixed_rate, pay_fixed=pay_fixed)
    result = price(snapshot, swap)
    d = result["dv01"]

    direction = "Pay Fixed / Receive Float" if pay_fixed else "Receive Fixed / Pay Float"
    print(f"\n{'=' * 52}")
    print(f"  Swap details")
    print(f"{'-' * 52}")
    print(f"  Direction    : {direction}")
    print(f"  Tenor        : {tenor}Y")
    print(f"  Notional     : {_fmt_npv(notional)} KRW")
    print(f"  Fixed rate   : {_fmt_rate(fixed_rate)}")
    print(f"{'-' * 52}")
    print(f"  NPV          : {_fmt_npv(result['npv'])} KRW")
    print(f"  Fixed leg PV : {_fmt_npv(result['fixed_leg_pv'])} KRW")
    print(f"  Float leg PV : {_fmt_npv(result['float_leg_pv'])} KRW")
    print(f"  Par rate     : {_fmt_rate(result['par_rate'])}")
    print(f"  DV01         : {_fmt_npv(d)} KRW / bp")
    print(f"{'=' * 52}\n")

    return {
        "valuation_date": snapshot.valuation_date,
        "tenor": tenor,
        "notional": notional,
        "fixed_rate": fixed_rate,
        "pay_fixed": pay_fixed,
        "trade_date": None,
        "remaining_tenor": float(tenor),
        "par_rate": result["par_rate"],
        "npv": result["npv"],
        "fixed_leg_pv": result["fixed_leg_pv"],
        "float_leg_pv": result["float_leg_pv"],
        "dv01": d,
        "mtm_pnl": None,
        "timestamp": datetime.now(),
    }


def price_mtm(
    snapshot: MarketSnapshot,
    trade_date: date,
    tenor: int,
    notional: float,
    fixed_rate: float,
    pay_fixed: bool,
) -> dict:
    """Reprice an existing swap (contracted on trade_date at fixed_rate) against today's curve."""
    from irs_pricer.services.pricing_service import price

    maturity_date = trade_date + relativedelta(years=tenor)
    remaining_tenor = (maturity_date - snapshot.valuation_date).days / 365

    swap = VanillaSwap(
        tenor_years=tenor,
        notional=notional,
        fixed_rate=fixed_rate,
        pay_fixed=pay_fixed,
        trade_date=trade_date,
        maturity_date=maturity_date,
    )
    result = price(snapshot, swap)
    d = result["dv01"]

    direction = "Pay Fixed / Receive Float" if pay_fixed else "Receive Fixed / Pay Float"
    print(f"\n{'=' * 52}")
    print(f"  MTM repricing")
    print(f"{'-' * 52}")
    print(f"  Direction        : {direction}")
    print(f"  Trade date       : {trade_date}")
    print(f"  Maturity         : {maturity_date}")
    print(f"  Original tenor   : {tenor}Y")
    print(f"  Remaining tenor  : {remaining_tenor:.2f}Y")
    print(f"  Notional         : {_fmt_npv(notional)} KRW")
    print(f"  Contracted rate  : {_fmt_rate(fixed_rate)}")
    print(f"  Current par rate : {_fmt_rate(result['par_rate'])}")
    print(f"{'-' * 52}")
    print(f"  MTM P&L          : {result['npv']:+,.0f} KRW")
    print(f"{'=' * 52}\n")

    return {
        "valuation_date": snapshot.valuation_date,
        "tenor": tenor,
        "notional": notional,
        "fixed_rate": fixed_rate,
        "pay_fixed": pay_fixed,
        "trade_date": trade_date,
        "remaining_tenor": remaining_tenor,
        "par_rate": result["par_rate"],
        "npv": result["npv"],
        "fixed_leg_pv": result["fixed_leg_pv"],
        "float_leg_pv": result["float_leg_pv"],
        "dv01": d,
        "mtm_pnl": result["npv"],
        "timestamp": datetime.now(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="KRW IRS NPV Calculator")
    parser.add_argument("--date", help="Valuation date YYYY-MM-DD (default: latest available)")
    parser.add_argument("--tenor", type=int, choices=_TENORS, help="Swap tenor in years")
    parser.add_argument("--notional", type=float, default=10_000_000_000, help="Notional KRW (default 10bn)")
    parser.add_argument("--fixed-rate", type=float, dest="fixed_rate", help="Fixed rate in %% (e.g. 3.51)")
    parser.add_argument("--receiver", action="store_true", help="Receive fixed / pay float (default: pay fixed)")
    parser.add_argument(
        "--trade-date",
        dest="trade_date",
        help="Original trade date YYYY-MM-DD; reprices an existing swap (MTM)",
    )
    parser.add_argument(
        "--source",
        help="Path to the Infomax Excel export file or a CSV directory (default: the shared Data/ folder)",
    )
    parser.add_argument(
        "--export",
        help="Write pricing results to an Excel file (appends a row if it already exists)",
    )
    args = parser.parse_args()

    source = Path(args.source) if args.source else DATA_DIR
    print(f"  Data source: {source}")

    if args.date:
        valuation_date = datetime.strptime(args.date, "%Y-%m-%d").date()
    else:
        valuation_date = latest_common_date(source)
        print(f"  No --date supplied; using latest available: {valuation_date}")

    try:
        snapshot = load_market_snapshot(source, valuation_date)
    except NonBusinessDayError as e:
        print(f"\n  Error: {e}")
        print("  No market data for non-business days. Use --date to specify a trading day.")
        return
    print_market_data(snapshot)

    export_row = None
    if args.trade_date:
        if not args.tenor or args.fixed_rate is None:
            print("\n  Error: --trade-date requires both --tenor and --fixed-rate (the contracted rate).")
            return
        trade_date = datetime.strptime(args.trade_date, "%Y-%m-%d").date()
        export_row = price_mtm(
            snapshot=snapshot,
            trade_date=trade_date,
            tenor=args.tenor,
            notional=args.notional,
            fixed_rate=args.fixed_rate / 100.0,
            pay_fixed=not args.receiver,
        )
    elif args.tenor:
        fixed_rate_dec = args.fixed_rate / 100.0 if args.fixed_rate is not None else None
        export_row = price_single(
            snapshot=snapshot,
            tenor=args.tenor,
            notional=args.notional,
            fixed_rate=fixed_rate_dec,
            pay_fixed=not args.receiver,
        )
    else:
        if args.export:
            print("\n  Note: --export requires --tenor (a single swap result); skipping export.")
        print("\n  Par rate table (notional 1bn KRW, pay fixed):")
        print_par_table(snapshot)
        print()
        print("  Tip: add --tenor <1|2|3|5|7|10> to price a specific swap.")

    if args.export and export_row is not None:
        from irs_pricer.loaders.total_data import export_result_xl

        export_result_xl(Path(args.export), export_row)
        print(f"  Result exported to {Path(args.export).resolve()}")


if __name__ == "__main__":
    main()
