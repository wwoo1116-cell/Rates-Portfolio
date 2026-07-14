"""
Curated instrument taxonomy for the Rates History / RV selector.

Maps the clean UI sector/rating names the frontend shows onto the exact raw
category strings that credit_matrix._load_indexed_rows() produces (verified
by a direct openpyxl read of Credit Matrix Data.xlsx -- these are
copy-sensitive: they carry the shared `시가평가 3사평균 ` prefix, mix spaced
`AA`/`A` with glued `AA0`/`A0`/`BBB0` notation across sectors, and glue the
notch into `회사채AAA(공모/무보증)` with no space).

Sector -> raw-curve mapping is user-confirmed:
  - 시은채  -> 은행채 (bank bonds; the literal "시은채" isn't a source category)
  - 여전채  -> 카드채 + 기타금융채 (both financial-sector, disambiguated by a
              display qualifier so both stay reachable in one flat rating list)
  - 회사채  -> 공모/무보증 + 사모/무보증 (both, disambiguated the same way)

국고채 lives inside Credit Matrix Data.xlsx too (category "시가평가 3사평균
국고채권"), so it's a credit_matrix-backed sector here. IRS is NOT in credit
matrix -- it's served frontend-side from the existing /api/rate-history full
curve -- so IRS is only listed in the taxonomy tree (for the dropdowns), with
no raw-category mapping in SECTORS.
"""

from __future__ import annotations

_PREFIX = "시가평가 3사평균 "

# Clean tenor label -> raw Credit Matrix tenor sub-header, in curve order.
# The 16 credit-matrix tenor points (note 2.5Y/50Y present, and no 6Y/8Y/9Y).
CREDIT_TENORS: dict[str, str] = {
    "3M": "3월이하(당일)",
    "6M": "6월이하(당일)",
    "9M": "9월이하(당일)",
    "1Y": "1년이하(당일)",
    "1.5Y": "1.5년이하(당일)",
    "2Y": "2년이하(당일)",
    "2.5Y": "2.5년이하(당일)",
    "3Y": "3년이하(당일)",
    "4Y": "4년이하(당일)",
    "5Y": "5년이하(당일)",
    "7Y": "7년이하(당일)",
    "10Y": "10년이하(당일)",
    "15Y": "15년이하(당일)",
    "20Y": "20년이하(당일)",
    "30Y": "30년이하(당일)",
    "50Y": "50년이하(당일)",
}

# IRS swap tenors, served from /api/rate-history (rate_history_service). "3M"
# resolves to CD91D (cd_rate), the 3M IRS reference; the rest are the raw
# swap-quote labels present in that endpoint's tenor_rates map.
IRS_TENORS: list[str] = [
    "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y",
    "6Y", "7Y", "8Y", "9Y", "10Y", "11Y", "12Y", "15Y", "20Y", "25Y", "30Y",
]

# Sentinel used as the single "rating" key for unrated sectors (국고채).
NO_RATING = ""


def _c(suffix: str) -> str:
    """Full raw category key = shared prefix + sector/rating suffix."""
    return _PREFIX + suffix


# ui_sector -> {display_rating -> raw_category_key}. Order of insertion is the
# order shown in the rating dropdown. For unrated sectors the single key is
# NO_RATING. For the two multi-bucket sectors (여전채, 회사채) the display
# rating carries a source qualifier so both curve families stay reachable.
SECTORS: dict[str, dict[str, str]] = {
    "국고채": {
        NO_RATING: _c("국고채권"),
    },
    "공사채": {
        "정부보증": _c("공사/공단채 (정부보증)"),
        "AAA": _c("공사/공단채 AAA"),
        "AA+": _c("공사/공단채 AA+"),
        "AA": _c("공사/공단채 AA"),
        "AA-": _c("공사/공단채 AA-"),
    },
    "시은채": {
        "AAA": _c("금융채 은행채 AAA"),
        "AA+": _c("금융채 은행채 AA+"),
        "AA": _c("금융채 은행채 AA"),
        "AA-": _c("금융채 은행채 AA-"),
        "A+": _c("금융채 은행채 A+"),
        "A": _c("금융채 은행채 A"),
        "A-": _c("금융채 은행채 A-"),
    },
    "여전채": {
        # 카드채 (credit-card issuers) -- source notation is spaced AA/A but
        # glued BBB0.
        "AAA (카드)": _c("금융채 카드채 AAA"),
        "AA+ (카드)": _c("금융채 카드채 AA+"),
        "AA (카드)": _c("금융채 카드채 AA"),
        "AA- (카드)": _c("금융채 카드채 AA-"),
        "A+ (카드)": _c("금융채 카드채 A+"),
        "A (카드)": _c("금융채 카드채 A"),
        "A- (카드)": _c("금융채 카드채 A-"),
        "BBB+ (카드)": _c("금융채 카드채 BBB+"),
        "BBB (카드)": _c("금융채 카드채 BBB0"),
        "BBB- (카드)": _c("금융채 카드채 BBB-"),
        # 기타금융채 (other consumer-finance issuers; no AAA tier) -- source
        # notation is glued AA0/A0/BBB0 with no space.
        "AA+ (기타)": _c("기타금융채AA+"),
        "AA (기타)": _c("기타금융채AA0"),
        "AA- (기타)": _c("기타금융채AA-"),
        "A+ (기타)": _c("기타금융채A+"),
        "A (기타)": _c("기타금융채A0"),
        "A- (기타)": _c("기타금융채A-"),
        "BBB+ (기타)": _c("기타금융채BBB+"),
        "BBB (기타)": _c("기타금융채BBB0"),
        "BBB- (기타)": _c("기타금융채BBB-"),
    },
    "회사채": {
        # 공모/무보증 (public, unguaranteed) -- fullest scale, glued AA0/A0 etc.
        "AAA (공모)": _c("회사채AAA(공모/무보증)"),
        "AA+ (공모)": _c("회사채AA+(공모/무보증)"),
        "AA (공모)": _c("회사채AA0(공모/무보증)"),
        "AA- (공모)": _c("회사채AA-(공모/무보증)"),
        "A+ (공모)": _c("회사채A+(공모/무보증)"),
        "A (공모)": _c("회사채A0(공모/무보증)"),
        "A- (공모)": _c("회사채A-(공모/무보증)"),
        "BBB+ (공모)": _c("회사채BBB+(공모/무보증)"),
        "BBB (공모)": _c("회사채BBB0(공모/무보증)"),
        "BBB- (공모)": _c("회사채BBB-(공모/무보증)"),
        "BB+ (공모)": _c("회사채BB+(공모/무보증)"),
        "BB (공모)": _c("회사채BB0(공모/무보증)"),
        "BB- (공모)": _c("회사채BB-(공모/무보증)"),
        "B (공모)": _c("회사채B(공모/무보증)"),
        # 사모/무 (private placement, unguaranteed) -- stops at BBB-.
        "AAA (사모)": _c("회사채AAA(사모/무)"),
        "AA+ (사모)": _c("회사채AA+(사모/무)"),
        "AA (사모)": _c("회사채AA0(사모/무)"),
        "AA- (사모)": _c("회사채AA-(사모/무)"),
        "A+ (사모)": _c("회사채A+(사모/무)"),
        "A (사모)": _c("회사채A0(사모/무)"),
        "A- (사모)": _c("회사채A-(사모/무)"),
        "BBB+ (사모)": _c("회사채BBB+(사모/무)"),
        "BBB (사모)": _c("회사채BBB0(사모/무)"),
        "BBB- (사모)": _c("회사채BBB-(사모/무)"),
    },
}

# Credit-matrix-backed sectors expose the 16 credit tenors; IRS is served
# separately from rate-history and exposes its own 20-tenor list.
IRS_SECTOR = "IRS"


def raw_category(sector: str, rating: str) -> str | None:
    """Raw Credit Matrix category key for a (sector, display_rating) pair, or
    None if the sector isn't credit-matrix-backed (e.g. IRS) or the rating is
    unknown."""
    return SECTORS.get(sector, {}).get(rating)


def tenors_for(sector: str) -> list[str]:
    return IRS_TENORS if sector == IRS_SECTOR else list(CREDIT_TENORS.keys())


def ratings_for(sector: str) -> list[str]:
    """Display ratings for a sector's dropdown. Empty list for unrated sectors
    (국고채) and IRS -- the frontend auto-fills those as N/A and skips the
    rating step."""
    if sector == IRS_SECTOR:
        return []
    ratings = list(SECTORS.get(sector, {}).keys())
    return [r for r in ratings if r != NO_RATING]


# Public sector order for the taxonomy tree (국고채 and IRS first as the
# unrated benchmarks, then the rated credit sectors).
SECTOR_ORDER: list[str] = ["국고채", IRS_SECTOR, "공사채", "시은채", "여전채", "회사채"]
