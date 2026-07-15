"""
Credit-curve service: exposes the credit_matrix taxonomy as browsable
instruments and pulls per-(sector, rating, tenor) yield time series for the
Rates History / RV selector.

Only credit_matrix-backed sectors are served here (국고채 + the four rated
credit sectors). IRS is deliberately NOT handled here -- the frontend already
fetches the full IRS curve once via /api/rate-history (for its click-to-trace
interaction) and resolves IRS legs from that, so routing IRS through here too
would just duplicate that fetch. The taxonomy tree still lists IRS (for the
dropdowns); its series simply come from the other endpoint.
"""

from __future__ import annotations

import re
from datetime import date

from ..config import DATA_DIR, require_data_dir
from ..core import ttl_cache
from ..loaders import credit_matrix, credit_taxonomy

# Kept as a module attribute for one release: bond_cashflow_service reached in
# here for it before config.DATA_DIR existed. Drop once that import is updated.
_DATA_DIR = DATA_DIR


def get_taxonomy() -> dict:
    """Static instrument tree for the selector dropdowns: every sector with its
    ordered rating list (empty for unrated 국고채 and IRS) and tenor list
    (16 credit tenors, or 20 IRS tenors). No file I/O -- derived from the
    curated credit_taxonomy tables."""
    return {
        "sectors": [
            {
                "sector": sector,
                "ratings": credit_taxonomy.ratings_for(sector),
                "tenors": credit_taxonomy.tenors_for(sector),
            }
            for sector in credit_taxonomy.SECTOR_ORDER
        ]
    }


def get_series(
    sector: str,
    rating: str | None,
    tenor: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> list[dict]:
    """Decimal-rate time series for one credit_matrix-backed leg, as
    [{valuation_date, value}] ascending by date.

    Raises ValueError for an IRS leg (served elsewhere) or an unknown
    sector/rating/tenor combination, so a bad request comes back as a clean
    400 rather than an empty-but-silent series."""
    require_data_dir()

    if sector == credit_taxonomy.IRS_SECTOR:
        raise ValueError("IRS 시리즈는 /api/rate-history에서 제공됩니다.")

    category = credit_taxonomy.raw_category(sector, rating or credit_taxonomy.NO_RATING)
    if category is None:
        raise ValueError(f"알 수 없는 섹터/등급입니다: {sector} / {rating}")

    raw_tenor = credit_taxonomy.CREDIT_TENORS.get(tenor)
    if raw_tenor is None:
        raise ValueError(f"알 수 없는 테너입니다: {tenor}")

    series = credit_matrix.category_series(DATA_DIR, category, raw_tenor, start_date, end_date)
    return [{"valuation_date": d, "value": v} for d, v in series]


# ── 채권 할인용 시장수익률(시장유통수익률) 조회 ────────────────────────────────
# 업로드된 blotter의 채권 섹터(loaders/portfolio.py:_BOND_SECTOR_MAP 어휘)를 Credit
# Matrix 택소노미 섹터로 매핑한다. Matrix에 자체 커브가 없는 섹터는 가장 가까운
# 커브로 폴백한다(통안채→국고채, 특은채→시은채). 국고채/통안채는 무등급.
_SECTOR_TO_TAXONOMY: dict[str, str] = {
    "국고채": "국고채",
    "통안채": "국고채",   # 폴백: Matrix에 통안채 커브 없음 → 국고채 커브
    "특은채": "시은채",   # 폴백: 특수은행채 → 은행채 커브
    "시은채": "시은채",
    "공사채": "공사채",
    "여전채": "여전채",
    "회사채": "회사채",
}


def _tenor_to_years(label: str) -> float:
    """'3M'→0.25, '9M'→0.75, '1.5Y'→1.5, '10Y'→10.0."""
    if label.endswith("M"):
        return int(label[:-1]) / 12.0
    return float(label[:-1])


_FLAT_RATING = re.compile(r"^(AAA|AA|A|BBB|BB|B)0$")


def _normalize_blotter_rating(rating: str) -> str:
    """붙임표기 'AA0'/'A0'/'BBB0'(= 플랫 등급)을 표시표기 'AA'/'A'/'BBB'로 정규화.

    Credit Matrix 원본은 같은 등급을 섹터마다 다르게 적는다 -- 은행채는 띄어쓴 'AA',
    회사채/기타금융채는 붙인 'AA0'(credit_taxonomy 참조: '회사채AA0(공모/무보증)'의
    표시등급이 'AA (공모)'). blotter(신용등급 열)는 붙임표기로 내려오므로 정규화 없이는
    'AA0' 종목이 커브를 못 찾고 통째로 탈락한다(실제 워크북 273종 중 6종).

    'AAA'는 끝의 0이 없어 매칭되지 않는다 -- 'AA'로 강등되지 않는다.
    """
    m = _FLAT_RATING.match(rating)
    return m.group(1) if m else rating


def _resolve_rating(taxonomy_sector: str, rating: str | None) -> str:
    """blotter의 평이한 등급(예: 'AA')을 택소노미 표시등급으로 해석. 여전채/회사채는
    표시등급에 (카드)/(공모) 등 한정어가 붙으므로 한정어를 벗겨 매칭하되 공모/카드를
    우선한다. 매칭 실패 시 NO_RATING(→ raw_category None → 상위에서 명확한 에러)."""
    if not rating:
        return credit_taxonomy.NO_RATING
    rating = _normalize_blotter_rating(rating)
    available = list(credit_taxonomy.SECTORS.get(taxonomy_sector, {}).keys())
    if rating in available:
        return rating
    matches = [r for r in available if r.split(" (")[0] == rating]
    if not matches:
        return credit_taxonomy.NO_RATING
    for pref in ("(공모)", "(카드)"):
        for m in matches:
            if pref in m:
                return m
    return matches[0]


def _interp(points: list[tuple[float, float]], x: float) -> float:
    """정렬된 (년수, 값) 포인트에서 x의 선형보간(양 끝은 flat 외삽)."""
    if x <= points[0][0]:
        return points[0][1]
    if x >= points[-1][0]:
        return points[-1][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x0 <= x <= x1:
            if x1 == x0:
                return y0
            w = (x - x0) / (x1 - x0)
            return y0 + w * (y1 - y0)
    return points[-1][1]


def _curve_points(category: str, val_date: date | None) -> list[tuple[float, float]]:
    """(잔존년수, decimal rate) 포인트를 테너 순으로 정렬해 반환. val_date 기준
    각 테너의 최신값(val_date 이하)을 사용한다.

    TTL 캐시: 한 (category, val_date)의 커브는 그 섹터×등급을 공유하는 모든 채권에
    대해 동일하고, 종목별로 다른 것은 보간 지점(remaining_years)뿐이다. 캐시가 없으면
    북 전체를 5개 날짜로 평가할 때 같은 커브를 종목 수만큼 다시 만든다(2026-07-15
    bootstrap_zero_curve 178배 중복과 동일한 형태).

    반환 리스트는 참조로 공유된다 -- 호출자는 읽기 전용으로 다뤄야 한다(_interp는
    읽기만 한다). load_fixings()의 캐시 규약과 동일.
    """
    return ttl_cache.get_or_compute(
        ("credit-curve-points", category, val_date),
        lambda: _build_curve_points(category, val_date),
    )


def _build_curve_points(category: str, val_date: date | None) -> list[tuple[float, float]]:
    require_data_dir()
    curve = credit_matrix.curve_at(DATA_DIR, category, val_date)
    points = [
        (_tenor_to_years(label), curve[raw_tenor])
        for label, raw_tenor in credit_taxonomy.CREDIT_TENORS.items()
        if raw_tenor in curve
    ]
    points.sort()
    return points


def market_yield_for(
    sector: str,
    rating: str | None,
    remaining_years: float,
    val_date: date | None = None,
) -> float:
    """채권 할인용 시장수익률(decimal)을 Credit Matrix에서 조회한다. 섹터×등급의
    커브를 val_date(미지정 시 최신) 기준으로 전 테너 값을 모아 잔존만기
    remaining_years에서 선형보간한다.

    Raises ValueError로 알 수 없는 섹터/등급 또는 값 부재 시 400으로 매핑되게 한다.
    """
    taxonomy_sector = _SECTOR_TO_TAXONOMY.get(sector, sector)
    disp_rating = _resolve_rating(taxonomy_sector, rating)
    category = credit_taxonomy.raw_category(taxonomy_sector, disp_rating)
    if category is None:
        raise ValueError(f"신용 커브를 찾을 수 없습니다: {sector} / {rating}")

    points = _curve_points(category, val_date)
    if not points:
        raise ValueError(f"신용 커브 값이 없습니다: {sector} / {rating}")
    return _interp(points, remaining_years)
