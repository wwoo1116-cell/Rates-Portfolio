"""
Column-layout constants for True Data.xlsx (Infomax single-sheet wide format).

Shared between loaders/true_data.py and scripts/data_updater.py so a schema
change only requires editing this one file.
"""

# Column indices (0-based) for the wide-format sheet
COL_VAL_DATE = 0
COL_CD_91D = 2
HEADER_ROWS = 3

# tenor_years -> MID column index (0-based)
IRS_MID_COLS: dict[int, int] = {
    1: 14,
    2: 22,
    3: 26,
    4: 30,
    5: 34,
    6: 38,
    7: 42,
    8: 46,
    9: 50,
    10: 54,
}
