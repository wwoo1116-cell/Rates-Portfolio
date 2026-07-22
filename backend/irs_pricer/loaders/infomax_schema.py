"""
Column-layout constants for True Data.xlsx (Infomax single-sheet wide format).

Shared between loaders/true_data.py and scripts/data_updater.py so a schema
change only requires editing this one file.

Layout (confirmed by reading the raw header rows directly): 19 repeating
[일자, 매수종가, 매도종가, MID종가] (date/bid/ask/MID) blocks -- 6M, 9M, 1Y,
1.5Y(18M), 2Y..10Y, 11Y, 12Y, 15Y, 20Y, 25Y, 30Y -- followed by a single CD91D
column ("CD 3사평균 AAA" / "3월(적용일)", one rate, no bid/ask/mid split).
"""

# Column indices (0-based) for the wide-format sheet
COL_VAL_DATE = 0
COL_CD_91D = 77
HEADER_ROWS = 3

# (tenor_years, tenor_months, MID column index) for every IRS tenor block.
# tenor_months is None for whole-year tenors (RateQuote's existing whole-year
# convention); set for the sub-year/fractional ones (6M, 9M, 1.5Y), with
# tenor_years populated as a rounded nominal value alongside it (see
# RateQuote's own docstring in core/market_data.py). MID column = that
# block's own start column + 3 (date, bid, ask, MID).
IRS_TENORS: list[tuple[int, int | None, int]] = [
    (1, 6, 3),      # 6M
    (1, 9, 7),      # 9M
    (1, None, 11),  # 1Y
    (2, 18, 15),    # 1.5Y
    (2, None, 19),  # 2Y
    (3, None, 23),
    (4, None, 27),
    (5, None, 31),
    (6, None, 35),
    (7, None, 39),
    (8, None, 43),
    (9, None, 47),
    (10, None, 51),
    (11, None, 55),
    (12, None, 59),
    (15, None, 63),
    (20, None, 67),
    (25, None, 71),
    (30, None, 75),
]
