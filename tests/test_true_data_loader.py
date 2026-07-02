from datetime import date
from pathlib import Path

import pytest

from irs_pricer.loaders import true_data

_DATA_DIR = Path(__file__).resolve().parents[1]


def test_common_dates_xlsx_returns_sorted_dates():
    dates = true_data.common_dates_xlsx(_DATA_DIR)
    assert len(dates) > 0
    assert dates == sorted(dates)


def test_load_market_snapshot_xlsx_returns_expected_shape_for_known_date():
    known_date = true_data.common_dates_xlsx(_DATA_DIR)[-1]
    snapshot = true_data.load_market_snapshot_xlsx(_DATA_DIR, known_date)
    assert snapshot.valuation_date == known_date
    assert snapshot.cd_rate > 0
    assert len(snapshot.swap_quotes) > 0


def test_load_market_snapshot_xlsx_raises_for_date_not_in_workbook():
    # Ordinary business-day Tuesday, well before the workbook's earliest date.
    with pytest.raises(ValueError):
        true_data.load_market_snapshot_xlsx(_DATA_DIR, date(2010, 6, 15))


def test_load_fixing_history_xlsx_covers_all_common_dates():
    dates = true_data.common_dates_xlsx(_DATA_DIR)
    history = true_data.load_fixing_history_xlsx(_DATA_DIR)
    assert set(dates) <= set(history.keys())
    assert all(rate > 0 for rate in history.values())


def test_indexed_cache_is_consistent_across_repeated_calls():
    """Guards against the indexed-cache refactor silently returning stale or
    partial data on a second call (e.g. a cache-key collision with the plain
    row-list cache under the same source file)."""
    first = true_data.common_dates_xlsx(_DATA_DIR)
    second = true_data.common_dates_xlsx(_DATA_DIR)
    assert first == second

    known_date = first[-1]
    snapshot_1 = true_data.load_market_snapshot_xlsx(_DATA_DIR, known_date)
    snapshot_2 = true_data.load_market_snapshot_xlsx(_DATA_DIR, known_date)
    assert snapshot_1 == snapshot_2
