"""Guard tests for the bond static params in loaders/portfolio.py (S2).

The bond sheet's 발행일자/만기일자 are apostrophe-prefixed text cells; the
parser used to pin start_date/maturity_date to None without ever reading
them, which blanked every bond's dates on the Portfolio grid and disabled
the Home allocation charts. These tests pin the extraction against both
synthetic rows and the real workbook.
"""

from datetime import date
from pathlib import Path

import openpyxl
import pytest

from irs_pricer.loaders import portfolio

REAL_XLSX = Path(__file__).resolve().parents[2] / "Data" / portfolio.XLSX_NAME

# A minimal valid bond row: the fields _parse_bond_row refuses to go on
# without, plus the static params under test.
BOND_ROW = {
    "종목명": "산업금융채권 25신이0106-0522-1",
    "상품소분류명": "특수은행채",
    "펀드명": "",
    "잔존일수": 244,
    "결제장부수량(만)": 2_000_000,
    "평가금액": 19_990_220_000,
    "듀레이션": 0.6597,
    "Duration가중 평가액": 13_187_548_134,
    "매수수익율": 2.789,
    "민평수익율": 2.881,
    "발행일자": "'2025-05-22",
    "만기일자": "'2026-11-22",
    "표면이율": 2.5,
    "신용등급": "AAA",
}


def _parse_bond(overrides: dict) -> dict:
    parsed = portfolio._parse_bond_row({**BOND_ROW, **overrides}, index=0)
    assert parsed is not None
    return parsed


def test_apostrophe_prefixed_dates_are_extracted():
    parsed = _parse_bond({})

    assert parsed["issue_date"] == date(2025, 5, 22)
    assert parsed["maturity_date"] == date(2026, 11, 22)
    # start_date carries the issue date too, so the frontend's bond mapping
    # works whichever of the two fields it reads.
    assert parsed["start_date"] == date(2025, 5, 22)


def test_coupon_and_rating_are_extracted():
    parsed = _parse_bond({})

    assert parsed["coupon_rate"] == 2.5
    assert parsed["rating"] == "AAA"
    # Sector-convention inference is an owner decision -- must stay unset.
    assert "payment_frequency" not in parsed


def test_a_malformed_date_becomes_none_not_a_wrong_date():
    """Strict parse: garbage must never round to a plausible date -- a wrong
    date prices wrong, a None only degrades to the analytic fallback."""
    for garbage in ("'2026-13-45", "0000-00-00", "2026/11/22", "만기없음", "'"):
        parsed = _parse_bond({"만기일자": garbage})
        assert parsed["maturity_date"] is None, f"{garbage!r} parsed to {parsed['maturity_date']}"
    # ...while the row itself still parses (Optional contract, no validation error).
    assert _parse_bond({"만기일자": None})["maturity_date"] is None


def test_a_genuinely_blank_row_keeps_none_everywhere():
    parsed = _parse_bond({"발행일자": None, "만기일자": "", "표면이율": None, "신용등급": ""})

    assert parsed["issue_date"] is None
    assert parsed["start_date"] is None
    assert parsed["maturity_date"] is None
    assert parsed["coupon_rate"] is None
    assert parsed["rating"] is None


def test_a_real_date_cell_passes_through():
    """If a future export drops the text formatting, openpyxl hands back a
    datetime -- that must keep working without the apostrophe path."""
    from datetime import datetime

    parsed = _parse_bond({"발행일자": datetime(2025, 5, 22)})
    assert parsed["issue_date"] == date(2025, 5, 22)


@pytest.fixture(scope="module")
def positions():
    return portfolio.parse(REAL_XLSX.parent)


@pytest.fixture(scope="module")
def sheet_date_counts():
    """(rows with both dates, total data rows) straight off the bond sheet --
    the parser is held to the sheet's own numbers rather than a magic 273."""
    wb = openpyxl.load_workbook(REAL_XLSX, read_only=True, data_only=True)
    try:
        ws = wb[portfolio._find_bond_sheet(wb)]
        rows = ws.iter_rows(values_only=True)
        header = [str(h).strip() if h is not None else "" for h in next(rows)]
        dated = total = 0
        for raw in rows:
            if all(v is None for v in raw):
                continue
            total += 1
            d = dict(zip(header, raw))
            if d.get("발행일자") not in (None, "") and d.get("만기일자") not in (None, ""):
                dated += 1
        return dated, total
    finally:
        wb.close()


@pytest.mark.skipif(not REAL_XLSX.exists(), reason=f"real workbook not present at {REAL_XLSX}")
class TestRealWorkbook:
    def test_example_instrument_gets_its_ledger_dates(self, positions):
        lots = [
            p
            for p in positions
            if p["instrument_type"] == "bond" and p["position_id"] == "산업금융채권 25신이0106-0522-1"
        ]
        assert lots, "example instrument not found in the workbook"
        for p in lots:
            assert p["issue_date"] == date(2025, 5, 22)
            assert p["start_date"] == date(2025, 5, 22)
            assert p["maturity_date"] == date(2026, 11, 22)
            assert p["coupon_rate"] == 2.5
            assert p["rating"] == "AAA"

    def test_every_dated_sheet_row_comes_out_dated(self, positions, sheet_date_counts):
        sheet_dated, sheet_total = sheet_date_counts
        bonds = [p for p in positions if p["instrument_type"] == "bond"]
        dated = [p for p in bonds if p["issue_date"] and p["maturity_date"] and p["start_date"]]
        # The tight, non-magic contract: parsed-but-undated bonds can only
        # come from sheet rows genuinely missing a date (blank-not-zero), of
        # which this sheet has sheet_total - sheet_dated. For the current
        # file that's 0, i.e. 273/273 bonds dated.
        assert len(bonds) - len(dated) <= sheet_total - sheet_dated, (
            f"{len(bonds) - len(dated)} bonds lost their dates in parsing "
            f"(sheet has only {sheet_total - sheet_dated} genuinely undated rows)"
        )
        assert len(dated) > 0
