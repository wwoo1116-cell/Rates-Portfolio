"""
One-time ETL backfill: migrate historical market data from the Excel/CSV
sources into the market_data MySQL table (blueprint C.2).

Precedence (True Data wins, others only fill gaps -- never overwrite a date
True Data already covers, so there's exactly one authoritative row per
(date, tenor) even when sources disagree):
  1. True Data.xlsx    -- primary, every date it has
  2. Total Data.xlsx    -- gap-fill only for dates True Data doesn't cover
  3. CSV (CD_AAA_91D.csv + IRS_*Y.csv) -- gap-fill for whatever's still missing
  4. Call Rate Data.xlsx -- independent full pass -> ON rows (O/N doesn't
     exist in Total Data/CSV at all, and True Data's own on_rate is only
     populous where Call Rate happens to have a matching date -- so this
     pass is what actually backfills O/N for Total-Data/CSV-sourced dates)
  5. BOK Base Rate.xlsx  -- independent full pass -> BOK rows (sentinel tenor)

Requires: alembic upgrade head already run (tenor_pillar seeded, tables exist)
and a working DB connection (either IRS_PRICER_DATABASE_URL or a connection
saved via the Settings page).

Usage:
  python scripts/migrate_excel_to_mysql.py            # run the backfill
  python scripts/migrate_excel_to_mysql.py --dry-run   # just report what would be migrated
"""

from __future__ import annotations

import argparse

from irs_pricer.config import DATA_DIR
from irs_pricer.core.errors import NonBusinessDayError
from irs_pricer.db import repository
from irs_pricer.db.database import get_db
from irs_pricer.db.models import MarketDataSource
from irs_pricer.loaders import base_rate, call_rate, csv_loader, total_data, true_data

_PROGRESS_EVERY = 50


def _true_data_dates() -> list:
    path = DATA_DIR / true_data.XLSX_NAME
    if not path.exists():
        return []
    return true_data.common_dates_xlsx(DATA_DIR)


def _total_data_dates() -> list:
    path = DATA_DIR / "Total Data.xlsx"
    if not path.exists():
        return []
    return total_data.common_dates_xl(path)


def _csv_dates() -> list:
    path = DATA_DIR / "CD_AAA_91D.csv"
    if not path.exists():
        return []
    return csv_loader.common_dates(DATA_DIR)


def migrate_irs_and_cd(db, dry_run: bool) -> None:
    true_dates = set(_true_data_dates())
    total_dates = set(_total_data_dates()) - true_dates
    csv_dates = set(_csv_dates()) - true_dates - set(_total_data_dates())

    print(f"True Data.xlsx  : {len(true_dates)}건")
    print(f"Total Data.xlsx : {len(total_dates)}건 (gap-fill)")
    print(f"CSV             : {len(csv_dates)}건 (gap-fill)")
    if dry_run:
        return

    total_data_path = DATA_DIR / "Total Data.xlsx"

    for i, d in enumerate(sorted(true_dates), start=1):
        try:
            snapshot = true_data.load_market_snapshot_xlsx(DATA_DIR, d)
        except (NonBusinessDayError, ValueError) as e:
            print(f"  [skip] {d}: {e}")
            continue
        repository.upsert_snapshot(
            db, snapshot, source=MarketDataSource.TRUE_DATA, on_rate_source=MarketDataSource.CALL_RATE
        )
        if i % _PROGRESS_EVERY == 0:
            print(f"  True Data: {i}/{len(true_dates)}건 완료")

    for i, d in enumerate(sorted(total_dates), start=1):
        try:
            snapshot = total_data.load_market_snapshot_xl(total_data_path, d)
        except (NonBusinessDayError, ValueError) as e:
            print(f"  [skip] {d}: {e}")
            continue
        repository.upsert_snapshot(db, snapshot, source=MarketDataSource.TOTAL_DATA)
        if i % _PROGRESS_EVERY == 0:
            print(f"  Total Data: {i}/{len(total_dates)}건 완료")

    for i, d in enumerate(sorted(csv_dates), start=1):
        try:
            snapshot = csv_loader.load_market_snapshot_csv(DATA_DIR, d)
        except (NonBusinessDayError, ValueError) as e:
            print(f"  [skip] {d}: {e}")
            continue
        repository.upsert_snapshot(db, snapshot, source=MarketDataSource.CSV)
        if i % _PROGRESS_EVERY == 0:
            print(f"  CSV: {i}/{len(csv_dates)}건 완료")

    print(f"IRS/CD 합계: True Data {len(true_dates)} + Total Data {len(total_dates)} + CSV {len(csv_dates)}건")


def migrate_call_rate(db, dry_run: bool) -> None:
    rates = call_rate.all_rates(DATA_DIR)
    print(f"Call Rate Data.xlsx (O/N) : {len(rates)}건")
    if dry_run or not rates:
        return
    for i, (d, rate) in enumerate(sorted(rates.items()), start=1):
        repository.upsert_quote_row(
            db,
            valuation_date=d,
            instrument_type=repository.InstrumentType.ON,
            tenor_unit=repository.TenorUnit.D,
            tenor_count=1,
            mid_rate=rate,
            source=MarketDataSource.CALL_RATE,
        )
        if i % _PROGRESS_EVERY == 0:
            db.commit()
            print(f"  Call Rate: {i}/{len(rates)}건 완료")
    db.commit()


def migrate_bok_base_rate(db, dry_run: bool) -> None:
    rates = base_rate.all_rates(DATA_DIR)
    print(f"BOK Base Rate.xlsx        : {len(rates)}건")
    if dry_run or not rates:
        return
    for i, (d, rate) in enumerate(sorted(rates.items()), start=1):
        repository.upsert_quote_row(
            db,
            valuation_date=d,
            instrument_type=repository.InstrumentType.BOK,
            tenor_unit=repository.TenorUnit.D,
            tenor_count=0,
            mid_rate=rate,
            source=MarketDataSource.BOK_BASE,
        )
        if i % _PROGRESS_EVERY == 0:
            db.commit()
            print(f"  BOK Base Rate: {i}/{len(rates)}건 완료")
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description="Excel/CSV -> MySQL market_data backfill")
    parser.add_argument(
        "--dry-run", action="store_true", help="Report date counts per source without writing to the DB"
    )
    args = parser.parse_args()

    print(f"Data directory: {DATA_DIR}")
    if args.dry_run:
        print("(dry-run: DB 연결 없이 카운트만 확인합니다)\n")
        migrate_irs_and_cd(None, dry_run=True)
        migrate_call_rate(None, dry_run=True)
        migrate_bok_base_rate(None, dry_run=True)
        return

    db = next(get_db())
    try:
        migrate_irs_and_cd(db, dry_run=False)
        migrate_call_rate(db, dry_run=False)
        migrate_bok_base_rate(db, dry_run=False)
        print("\n마이그레이션이 완료되었습니다.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
