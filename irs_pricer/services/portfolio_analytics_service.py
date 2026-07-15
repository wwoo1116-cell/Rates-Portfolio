import logging
from collections import Counter, defaultdict
from dataclasses import astuple, dataclass
from datetime import date
from typing import Literal

from ..config import DATA_DIR, require_data_dir
from ..core import ttl_cache
from ..core.market_data import MarketSnapshot
from ..engine import bond_valuation
from ..engine.instruments import VanillaSwap
from ..engine.quant_engine import next_kr_business_day
from . import allocation_history_service
from . import credit_curve_service
from . import market_data_service
from . import portfolio_service
from ..loaders import base_rate
from ..loaders import credit_matrix

logger = logging.getLogger(__name__)

_TENOR_COLUMNS = ["1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "30Y"]

# PVBP 섹터 행 순서: 신용도 내림차순(국고채 → 회사채), IRS는 항상 마지막, 그 뒤 합계.
# 이름순 정렬이 아니라 명시적 순서다 -- 이름순은 신용도와 아무 관계가 없고,
# 'IRS'(라틴 문자, U+0049)가 모든 한글(U+AC00~)보다 앞서 정렬되어 맨 위로 올라온다.
_SECTOR_ORDER = ["국고채", "통안채", "공사채", "특은채", "시은채", "여전채", "회사채"]
_IRS_SECTOR = "IRS"
_TOTAL_SECTOR = "합계"

_SECTOR_RANK = {sector: i for i, sector in enumerate(_SECTOR_ORDER)}
# 알 수 없는 섹터는 회사채와 IRS 사이에 들어간다 (loaders/portfolio.py의
# _map_bond_sector가 매핑 실패 시 "기타"를 반환하므로 실제로 발생할 수 있다).
_RANK_KNOWN, _RANK_UNKNOWN, _RANK_IRS = 0, 1, 2


def _sector_sort_key(sector: str) -> tuple[int, int, str]:
    if sector == _IRS_SECTOR:
        return (_RANK_IRS, 0, "")
    rank = _SECTOR_RANK.get(sector)
    if rank is None:
        # 미지 섹터끼리는 이름순 -- 순서를 정할 근거가 없으니 최소한 결정적으로.
        return (_RANK_UNKNOWN, 0, sector)
    return (_RANK_KNOWN, rank, "")


def _sort_sector_rows(rows: list[dict]) -> list[dict]:
    """_SECTOR_ORDER 순서로 정렬. 데이터에 없는 섹터는 그냥 빠지고 순서는 유지된다.

    경고는 정렬 키 함수가 아니라 여기서 한 번만 찍는다: 키 함수는 sort가
    원소마다 여러 번 호출하므로 그 안에서 로깅하면 같은 섹터가 반복 출력된다.
    """
    unknown = sorted({r["sector"] for r in rows} - _SECTOR_RANK.keys() - {_IRS_SECTOR})
    if unknown:
        logger.warning(
            "PVBP 민감도: _SECTOR_ORDER에 없는 섹터 %s -- 회사채와 IRS 사이에 표시합니다. "
            "의도한 섹터라면 _SECTOR_ORDER에 신용도 순서로 추가하세요.",
            ", ".join(unknown),
        )
    return sorted(rows, key=lambda r: _sector_sort_key(r["sector"]))


@dataclass
class PositionData:
    """Lightweight mirror of ParsedPositionOut for use within the service layer,
    avoiding a circular import from api.models."""
    instrument_type: str  # "bond" | "irs"
    position_id: str
    sector: str
    book: str
    start_date: date | None = None
    maturity_date: date | None = None
    notional: float | None = None
    fixed_rate: float | None = None
    pay_fixed: bool | None = None
    float_spread: float | None = None
    evaluation_amount: float | None = None
    remaining_days: int | None = None
    tenor_bucket: str | None = None
    entry_yield: float | None = None
    mtm_yield: float | None = None
    duration: float | None = None
    pvbp: float | None = None
    # 채권 정적 파라미터 (blotter-parser.ts가 채워 보낸다). 쿠폰 스케줄을 만들려면
    # 반드시 있어야 하며, 없으면 채권을 재평가할 수 없다 -- build_book_daily_pnl이
    # 해석적(analytic) 폴백으로 내려간다. 스왑에는 해당 없음.
    issue_date: date | None = None
    coupon_rate: float | None = None      # 퍼센트, e.g. 3.125
    payment_frequency: int | None = None  # 2 (국고/통안) 또는 4 (크레딧)
    rating: str | None = None             # 국고채/통안채는 None


def _to_swap(p: PositionData) -> tuple[str, VanillaSwap]:
    nominal_tenor_years = max(1, round((p.maturity_date - p.start_date).days / 365))
    return (p.position_id, VanillaSwap(
        tenor_years=nominal_tenor_years,
        notional=p.notional,
        fixed_rate=p.fixed_rate,
        pay_fixed=p.pay_fixed,
        float_spread=p.float_spread or 0.0,
        trade_date=p.start_date,
        maturity_date=p.maturity_date,
    ))


def _shared_delta(
    snapshot: MarketSnapshot,
    swaps: list[tuple[str, VanillaSwap]],
    fixings: dict[date, float],
) -> portfolio_service.PortfolioDeltaResult:
    """price_portfolio_delta, memoised across the three Home analytics panels.

    All three (/pvbp-sensitivity, /book-daily-pnl, /book-summary) are fired at
    once by the same dashboard render, against the same snapshot and the same
    positions, and each used to recompute this from scratch -- the single most
    expensive call in the request, done three times for one identical answer.

    The key is content-addressed (the snapshot's own rates + every swap field
    via astuple), not an id() or a date, so it self-invalidates: any change to
    a quote or a position produces a different key rather than a stale hit.
    astuple() rather than a hand-listed field tuple means a field added to
    VanillaSwap later is picked up automatically instead of silently aliasing
    two different swaps onto one entry.

    `fixings` is deliberately NOT part of the key: price_portfolio_delta
    ignores it (it prices sensitivities off the curve alone). It stays in the
    signature because the underlying call takes it, and
    test_delta_is_independent_of_fixings pins the assumption so this key stops
    being valid loudly rather than silently.
    """
    key = (
        "portfolio-delta",
        snapshot.valuation_date,
        snapshot.cd_rate,
        snapshot.on_rate,
        tuple(astuple(q) for q in snapshot.swap_quotes),
        tuple((pid, astuple(s)) for pid, s in swaps),
    )
    return ttl_cache.get_or_compute(
        key, lambda: portfolio_service.price_portfolio_delta(snapshot, swaps, fixings)
    )


def _credit_shifts() -> dict[str, dict[str, float]]:
    """Day-over-day credit shift by sector x tenor -- shared reference data,
    identical for every position in every request against the same workbook."""
    return ttl_cache.get_or_compute(("credit-shifts",), lambda: credit_matrix.daily_shift(DATA_DIR))



def build_pvbp_sensitivity(
    positions: list[PositionData],
    snapshot: MarketSnapshot,
    fixings: dict[date, float]
) -> list[dict]:
    sectors = {p.sector for p in positions}
    rows = {sec: {c: 0.0 for c in _TENOR_COLUMNS} for sec in sectors}
    
    irs_positions = [p for p in positions if p.instrument_type == "irs"]
    bond_positions = [p for p in positions if p.instrument_type == "bond"]
    
    for b in bond_positions:
        if b.pvbp is not None and b.tenor_bucket in rows[b.sector]:
            rows[b.sector][b.tenor_bucket] += b.pvbp

    if irs_positions:
        swaps = [_to_swap(p) for p in irs_positions]
        delta_result = _shared_delta(snapshot, swaps, fixings)

        pid_to_sector = {p.position_id: p.sector for p in irs_positions}
        for pd in delta_result.position_deltas:
            sec = pid_to_sector[pd.position_id]
            for bkt in pd.buckets:
                col = "3M" if bkt.pillar == "CD91D" else bkt.pillar
                if col in rows[sec]:
                    rows[sec][col] += bkt.delta
                    
    result = []
    for sec, values in rows.items():
        row = {"sector": sec}
        row.update(values)
        row["total"] = sum(values.values())
        result.append(row)
        
    result = _sort_sector_rows(result)

    total_row = {"sector": _TOTAL_SECTOR, "total": sum(r["total"] for r in result)}
    for c in _TENOR_COLUMNS:
        total_row[c] = sum(r[c] for r in result)
    result.append(total_row)

    return result

@dataclass
class _PositionPnl:
    """한 포지션의 일간 손익 분해 결과.

    `mtm=None`은 "0"이 아니라 **모름**이다: 이 상품의 호가 소스에 as_of 데이터가
    아직 없다는 뜻. 0으로 채우면 "호가가 들어왔고 안 움직였다"는 다른 사실을
    주장하게 되므로, 값이 없음은 끝까지 None으로 들고 가서 화면에 "—"로 나간다.
    """
    position_id: str
    instrument_type: str
    book: str
    theta: float
    mtm: float | None
    funding: float = 0.0
    # 재평가 불가로 해석적 폴백을 쓴 경우 사유. None이면 정상 재평가.
    degraded_reason: str | None = None


# 상품별 호가 소스. 커버리지가 서로 다르다 -- 측정 시점 기준 Credit Matrix는
# 2026-07-13, IRS/CD는 2026-07-06까지였다. 그래서 "시장이 열렸는가"는 대시보드
# 전체에 하나로 답할 수 있는 질문이 아니고, 소스별로만 답할 수 있다.
_SOURCE_IRS = "IRS"
_SOURCE_CREDIT = "Credit Matrix"


def _source_dates() -> dict[str, list[date]]:
    """각 호가 소스가 보유한 날짜. TTL 캐시 -- 요청마다 워크북/DB를 다시 훑을 이유가 없다."""

    def build() -> dict[str, list[date]]:
        try:
            irs = market_data_service.list_available_dates()
        except ValueError:
            irs = []
        try:
            credit = credit_matrix.common_dates_xlsx(DATA_DIR)
        except (ValueError, FileNotFoundError):
            credit = []
        return {_SOURCE_IRS: sorted(irs), _SOURCE_CREDIT: sorted(credit)}

    return ttl_cache.get_or_compute(("quote-source-dates",), build)


def _quote_sources(as_of: date) -> list[dict]:
    """소스별 신선도. 화면 상단에 그대로 띄워, 어떤 셀이 왜 비어 있는지를
    사용자가 추측하지 않아도 되게 한다."""
    out = []
    for name, dates in _source_dates().items():
        out.append({
            "source": name,
            "latest": dates[-1].isoformat() if dates else None,
            "has_as_of": as_of in set(dates),
        })
    return out


def _snapshot_or_none(valuation_date: date) -> MarketSnapshot | None:
    """해당 일자의 시장 스냅샷. 없으면 None (예외를 삼키는 게 아니라 '아직
    호가가 없다'는 정상 상태를 표현한다)."""
    try:
        return market_data_service.load_snapshot(valuation_date)
    except Exception:
        return None


def _roll_quotes_to(snapshot: MarketSnapshot, valuation_date: date) -> MarketSnapshot:
    """같은 호가(par quotes)를 그대로 둔 채 평가일만 옮긴 스냅샷.

    세타의 정의 그 자체다: 커브 호가는 전일 종가에 고정하고 날짜만 하루 굴린다.
    par rate를 고정하므로 커브가 날짜와 함께 롤다운되며(캐리 + 롤다운 모두 포착),
    '할인커브를 절대적으로 고정'하는 다른 관행(캐리만 포착)과는 다르다.
    """
    return MarketSnapshot(
        valuation_date=valuation_date,
        cd_rate=snapshot.cd_rate,
        on_rate=snapshot.on_rate,
        swap_quotes=snapshot.swap_quotes,
    )


def _realized_swap_cash(
    irs_positions: list[PositionData],
    close_cashflows: list,
    close_date: date,
    as_of: date,
) -> list[float]:
    """(close, as_of] 구간에 실제로 지급되는 스왑 순현금, 포지션 순서대로.

    지급일이 이 창에 걸린 현금흐름은 T 시점 평가(cutoff: pd > val_date)에서
    스케줄 밖으로 빠진다. 포지션 가치는 그만큼 떨어지지만 데스크는 그 현금을
    받으므로, 이 금액을 세타에 되돌려주지 않으면 쿠폰일마다 세타가 쿠폰 PV만큼
    가짜로 급락한다(가치가 사라진 게 아니라 현금으로 전환된 것).

    부호: 엔진의 CashFlowDetail은 두 다리 모두 **무부호** 금액이다(방향은 NPV
    합산 단계에서 적용). receive-fixed면 고정 다리 +, 변동 다리 -; pay-fixed는
    반대. 이 창의 변동 지급액은 이미 직전 리셋에서 픽싱된 금액이라 결정적이다
    -- 세타(확정 손익)에 속하는 것이 맞다.

    중복 id 처리: 창에 걸린 흐름을 position_id로 묶은 뒤 같은 id의 로트 수로
    균등 분배한다. IRS id는 경제조건(시작-만기/금리)을 문자열에 인코딩하므로
    id가 같으면 로트별 흐름도 같아 균등 분배가 정확하고, 설령 아니어도 북 집계
    (화면이 보여주는 단위)는 같은 종목 로트가 같은 북에 있는 한 정확하다.
    """
    window = [
        pcf for pcf in close_cashflows
        if close_date < pcf.detail.payment_date <= as_of and pcf.detail.cashflow is not None
    ]
    if not window:
        return [0.0] * len(irs_positions)

    pay_fixed_by_pid = {p.position_id: p.pay_fixed for p in irs_positions}
    net_by_pid: dict[str, float] = defaultdict(float)
    for pcf in window:
        d = pcf.detail
        receive_fixed = not pay_fixed_by_pid[pcf.position_id]
        sign = 1.0 if (d.leg == "fixed") == receive_fixed else -1.0
        net_by_pid[pcf.position_id] += sign * d.cashflow

    counts = Counter(p.position_id for p in irs_positions)
    return [net_by_pid.get(p.position_id, 0.0) / counts[p.position_id] for p in irs_positions]


def _swap_pnl(
    irs_positions: list[PositionData],
    close_snapshot: MarketSnapshot,
    rolled_snapshot: MarketSnapshot,
    today_snapshot: MarketSnapshot | None,
    fixings: dict[date, float],
) -> list[_PositionPnl]:
    """스왑 MtM/세타. 실제 재평가로 구하며, 잔차 버킷이 없다.

        theta = V(T, c_close) - V(close, c_close) + (close, T] 실현 현금
        mtm   = V(T, c_T)     - V(T,     c_close)
        합     = V(T, c_T)     - V(close, c_close) + 실현 현금 = 경제적 ΔPnL

    실현 현금 항이 없으면 지급일이 close와 T 사이에 낀 날마다 세타가 쿠폰 PV만큼
    급락한다 -- 가치가 사라진 게 아니라 현금으로 전환됐을 뿐인데도. 두 평가 모두
    같은 커브(c_close)를 쓰고 픽싱도 이미 확정이므로 이 현금은 결정적이며,
    따라서 세타(개장 전에 이미 아는 손익)에 속한다. mtm은 두 다리 모두 빠진
    흐름을 똑같이 제외하므로 이 보정의 영향을 받지 않는다.

    이전 구현은 theta = (실제 ΔNPV) - (델타×시프트 1차 추정)의 **잔차**였다.
    즉 커브 형태 변화와 2차 효과가 전부 '세타'로 흘러들어갔다. 위 분해는
    잔차가 생길 수 없다 -- 망원급수 + 상수(현금)라 합이 곧 경제적 ΔPnL이다.

    clean_npv 기준(price_portfolio.net_npv)을 쓴다: 이 코드베이스가 ΔNPV를
    정의해 온 방식(historical_pnl_service)과 같아야 기존 총액이 보존되기 때문이다.
    """
    swaps = [_to_swap(p) for p in irs_positions]
    close_date = close_snapshot.valuation_date
    as_of = rolled_snapshot.valuation_date

    # position_id가 아니라 **순서**로 맞춘다. price_portfolio는 입력 순서대로
    # position_results를 append하므로 인덱스 대응이 보장된다. id로 dict를 만들면
    # 같은 id를 가진 포지션이 서로를 덮어써 손익에서 통째로 사라진다 -- 실제
    # 블로터에서 채권 id는 중복된다(같은 종목의 여러 로트, 최대 9건). IRS는 현재
    # 전부 유일하지만, 그 가정에 기대지 않는 편이 안전하다.
    res_close = portfolio_service.price_portfolio(close_snapshot, swaps, fixings)
    v_close = [r.clean_npv for r in res_close.position_results]
    cash = _realized_swap_cash(irs_positions, res_close.cashflows, close_date, as_of)

    def npvs(snap: MarketSnapshot) -> list[float]:
        res = portfolio_service.price_portfolio(snap, swaps, fixings)
        return [r.clean_npv for r in res.position_results]

    v_rolled = npvs(rolled_snapshot)

    if today_snapshot is None:
        # IRS 호가가 아직 없다 -> MtM은 0이 아니라 **모름**. 세 번째 평가를 하지
        # 않으며(할 커브가 없다), 세타는 그대로 확정값으로 남는다.
        return [
            _PositionPnl(position_id=p.position_id, instrument_type="irs", book=p.book,
                         theta=rolled - close + c, mtm=None, funding=0.0)
            for p, close, rolled, c in zip(irs_positions, v_close, v_rolled, cash)
        ]

    # 호가가 있으면 그 스냅샷을 그대로 쓰지 않고 평가일을 as_of로 **명시적으로** 맞춘다.
    # MtM의 정의가 "같은 날짜(T)에서 호가만 바꾼 값의 차이"이기 때문이다 -- 두 다리가
    # 날짜까지 다르면 세타가 MtM에 섞여 들어가 분해가 무너진다. 실무상
    # load_snapshot(as_of)는 valuation_date == as_of인 스냅샷을 주므로 이 롤은
    # no-op이지만, 그 가정에 암묵적으로 기대지 않는다.
    v_today = npvs(_roll_quotes_to(today_snapshot, as_of))

    return [
        _PositionPnl(
            position_id=p.position_id,
            instrument_type="irs",
            book=p.book,
            theta=rolled - close + c,
            mtm=today - rolled,
            # 스왑 조달비용은 의도적으로 모델링하지 않는다 (채권만 해당).
            funding=0.0,
        )
        for p, close, rolled, today, c in zip(irs_positions, v_close, v_rolled, v_today, cash)
    ]


def _bond_market_yield(p: PositionData, val_date: date, maturity: date) -> float:
    remaining_years = max((maturity - val_date).days / 365.0, 0.0)
    return credit_curve_service.market_yield_for(p.sector, p.rating, remaining_years, val_date)


def _bond_pnl(
    bond_positions: list[PositionData],
    close_date: date,
    as_of: date,
    credit_has_as_of: bool,
    funding_rate: float,
) -> list[_PositionPnl]:
    """채권 MtM/세타. 스왑과 같은 분해를 쓰되 할인은 커브가 아니라 Credit Matrix의
    단일 시장수익률(민평)로 한다.

    정적 파라미터(발행일/표면이율/지급주기)가 있으면 실제 재평가:
        theta = V(T, y_close) - V(close, y_close)
        mtm   = V(T, y_T)     - V(T,     y_close)
    없으면 해석적 폴백(캐리 + 1차 PVBP). 폴백 포지션도 결과에서 빠지지 않는다 --
    손익에서 조용히 사라지면 북 전체를 과소계상하게 된다.
    """
    accrual_days = (as_of - close_date).days
    out: list[_PositionPnl] = []

    for p in bond_positions:
        eval_amt = p.evaluation_amount or 0.0
        # 조달비용: 총액(ΔNPV) 밖의 별도 항목. 실제 경과일수로 계산한다
        # (금~월이면 하루가 아니라 3일치 -- 고정 1/365는 주말을 놓친다).
        funding = -eval_amt * funding_rate * accrual_days / 365.0

        schedulable = (
            p.issue_date is not None
            and p.maturity_date is not None
            and p.coupon_rate is not None
            and p.payment_frequency is not None
        )

        theta = 0.0
        # None = 모름 (Credit Matrix에 as_of 데이터가 없거나 커브 조회 실패).
        mtm: float | None = None
        reason: str | None = None

        if schedulable:
            try:
                y_close = _bond_market_yield(p, close_date, p.maturity_date)
                val_close = bond_valuation.value_bond(
                    asset_id=p.position_id, issue_date=p.issue_date,
                    maturity_date=p.maturity_date, coupon_rate=p.coupon_rate,
                    payment_frequency=p.payment_frequency, notional=p.notional or 0.0,
                    market_yield=y_close, val_date=close_date,
                )
                v_close = val_close.npv
                v_rolled = bond_valuation.value_bond(
                    asset_id=p.position_id, issue_date=p.issue_date,
                    maturity_date=p.maturity_date, coupon_rate=p.coupon_rate,
                    payment_frequency=p.payment_frequency, notional=p.notional or 0.0,
                    market_yield=y_close, val_date=as_of,
                ).npv
                # (close, T]에 지급일이 걸린 쿠폰/원금은 T 시점 평가에서 스케줄
                # 밖으로 빠진다(value_bond cutoff: pd > val_date). 그 현금은
                # 데스크가 실제로 수취하므로 세타에 되돌려준다 -- 아니면 쿠폰일마다
                # 세타가 쿠폰 금액만큼 가짜로 급락한다. 스왑의 _realized_swap_cash와
                # 같은 보정이며, 롱 보유 채권이므로 부호는 전부 +다.
                realized = sum(
                    c.cashflow for c in val_close.cashflows
                    if close_date < c.payment_date <= as_of and c.cashflow is not None
                )
                theta = v_rolled - v_close + realized

                if credit_has_as_of:
                    y_today = _bond_market_yield(p, as_of, p.maturity_date)
                    v_today = bond_valuation.value_bond(
                        asset_id=p.position_id, issue_date=p.issue_date,
                        maturity_date=p.maturity_date, coupon_rate=p.coupon_rate,
                        payment_frequency=p.payment_frequency, notional=p.notional or 0.0,
                        market_yield=y_today, val_date=as_of,
                    ).npv
                    mtm = v_today - v_rolled
            except ValueError as e:
                # 알 수 없는 섹터/등급이거나 커브 값 부재 -> 재평가 불가.
                schedulable = False
                reason = f"신용커브 조회 실패: {e}"

        if not schedulable:
            # 해석적 폴백: 세타 ≈ 경과일수만큼의 캐리(민평수익률 기준).
            if reason is None:
                reason = "정적 파라미터(발행일/표면이율/지급주기) 없음"
            theta = eval_amt * ((p.mtm_yield or 0.0) / 100.0) * accrual_days / 365.0
            if credit_has_as_of and p.maturity_date is not None:
                try:
                    dy_bp = (
                        _bond_market_yield(p, as_of, p.maturity_date)
                        - _bond_market_yield(p, close_date, p.maturity_date)
                    ) * 10_000.0
                    mtm = (p.pvbp or 0.0) * (-dy_bp)
                except ValueError:
                    # 커브를 못 읽으면 MtM은 0이 아니라 모름으로 남긴다.
                    mtm = None

        out.append(_PositionPnl(
            position_id=p.position_id, instrument_type="bond", book=p.book,
            mtm=mtm, theta=theta, funding=funding, degraded_reason=reason,
        ))
    return out


def build_book_daily_pnl(
    positions: list[PositionData],
    close_snapshot: MarketSnapshot,
    fixings: dict[date, float],
    funding_spread_bp: float = 10.0,
) -> dict:
    """일간 손익을 ΔPnL = MtM + 세타로 분해한다.

        theta : 커브/호가를 전일 종가에 고정한 채 평가일만 1영업일 굴린 값의 변화
                + (close, T]에 실제 지급되는 순현금 (쿠폰/원금 분리 보정)
                (둘 다 결정적 -- T 시점 개장 전에 이미 확정되어 있다)
        mtm   : 같은 날짜(T)에서 호가만 종가 -> 당일로 바꾼 값의 변화

    두 항은 망원급수로 상쇄되어 합이 정확히 ΔNPV가 된다. 잔차 버킷이 없다.

    `close_snapshot`은 **마지막 종가**다(호출자가 보내는 최신 스냅샷). 평가일 T는
    여기서 직접 구한다: T = 다음 영업일(종가일). 이렇게 두면 실시간 피드가 붙었을 때
    (종가 = 7/14 -> T = 7/15) 자동으로 맞아떨어진다.

    개장 전 상태(A2) -- 호가는 **소스별로** 판정한다:
      스왑 = IRS/CD 스냅샷, 채권 = Credit Matrix. 둘의 커버리지가 실제로 다르다
      (측정 시점 Matrix 2026-07-13, IRS 2026-07-06). "시장이 열렸는가"에 대시보드
      전체가 하나로 답할 수 없다는 뜻이므로, 소스별 신선도를 `quote_sources`로
      그대로 내보낸다.

    호가가 없는 상품의 MtM은 0이 아니라 **None**이다. 0은 "호가가 들어왔고 안
    움직였다"는 별개의 사실을 주장하는 값이라, 아직 모르는 것을 0으로 채우면
    리스크 화면에서 거짓말이 된다. 화면에는 "—"로 나간다.

    그래서 집계 행(book/포트폴리오)은 `mtm_complete`를 함께 낸다: 구성 상품 중
    하나라도 호가가 없으면 그 행의 MtM/Total은 **부분합**이며, 완성된 총액인 척
    표시해서는 안 된다.
    """
    # 아래 base_rate 로드는 `except Exception: pass`로 감싸여 있고 load_base_rate는
    # 파일이 없으면 None을 반환한다 -- 즉 데이터 폴더를 잘못 잡아도 조달금리가 조용히
    # 0이 될 뿐 아무도 알아채지 못한다. 폴더 자체는 그 try 바깥에서 확인해야 한다.
    require_data_dir()

    close_date = close_snapshot.valuation_date
    as_of = next_kr_business_day(close_date)
    rolled_snapshot = _roll_quotes_to(close_snapshot, as_of)

    # 소스별 판정. 스왑은 IRS 스냅샷 유무, 채권은 Credit Matrix에 as_of 행이
    # **정확히** 있는지로 본다 -- market_yield_for는 "as_of 이하 최신값" 의미라
    # 7/7이 없으면 조용히 7/6 커브를 돌려주고, 그러면 MtM이 "안 움직였다(0)"처럼
    # 보인다. 그건 "아직 모른다"와 전혀 다른 주장이므로 명시적으로 확인한다.
    sources = _quote_sources(as_of)
    has_irs = next(s["has_as_of"] for s in sources if s["source"] == _SOURCE_IRS)
    has_credit = next(s["has_as_of"] for s in sources if s["source"] == _SOURCE_CREDIT)
    today_snapshot = _snapshot_or_none(as_of) if has_irs else None

    # Funding rate = BOK 기준금리 + spread(bp). 실무 관행상 기준금리 위에 스프레드를
    # 얹어 조달비용을 잡으며, 기본값은 +10bp (대시보드 Settings에서 조정 가능).
    # load_base_rate는 파일/해당일 데이터가 없으면 None을 반환하므로 `or 0.0`로 방어.
    base = 0.0
    try:
        base = ttl_cache.get_or_compute(
            ("bok-base-rate", close_date),
            lambda: base_rate.load_base_rate(DATA_DIR, close_date),
        ) or 0.0
    except Exception:
        pass
    funding_rate = base + (funding_spread_bp or 0.0) / 10000.0

    irs_positions = [p for p in positions if p.instrument_type == "irs"]
    bond_positions = [p for p in positions if p.instrument_type == "bond"]

    legs: list[_PositionPnl] = []
    if irs_positions:
        legs += _swap_pnl(irs_positions, close_snapshot, rolled_snapshot, today_snapshot, fixings)
    if bond_positions:
        legs += _bond_pnl(bond_positions, close_date, as_of, has_credit, funding_rate)

    degraded = [l.position_id for l in legs if l.degraded_reason is not None]
    if degraded:
        logger.warning(
            "일간 손익: %d개 채권을 재평가하지 못해 해석적 폴백을 적용했습니다 (예: %s). "
            "사유: %s",
            len(degraded), ", ".join(degraded[:3]),
            next(l.degraded_reason for l in legs if l.degraded_reason),
        )

    def _aggregate(group: list[_PositionPnl], label_key: str, label: str) -> dict:
        """한 묶음의 집계.

        mtm=None(모름)인 구성원은 합계에서 **빠지고**, 그 사실이 mtm_complete=False로
        드러난다. 0으로 치환해 더하면 부분합이 완성된 총액처럼 보인다.
        하나도 모르면 mtm은 None -- 0이 아니라 "—"로 나가야 하기 때문이다.
        """
        known = [l.mtm for l in group if l.mtm is not None]
        complete = len(known) == len(group)
        theta = sum(l.theta for l in group)
        mtm = sum(known) if known else None
        return {
            label_key: label,
            "theta": theta,
            "mtm": mtm,
            # total은 아는 것만 더한 값이다. complete=False면 ΔNPV 전체가 아니라
            # "세타 + 지금까지 들어온 MtM"이라는 뜻.
            "total": theta + (mtm or 0.0),
            "funding": sum(l.funding for l in group),
            "mtm_complete": complete,
        }

    by_book = sorted(
        (_aggregate([l for l in legs if l.book == b], "book", b) for b in {p.book for p in positions}),
        key=lambda r: r["book"],
    )
    by_book.append(_aggregate(legs, "book", "Total"))

    portfolio = _aggregate(legs, "book", "Total")
    return {
        "as_of": as_of.isoformat(),
        # 소스별 신선도. 단일 "장 열림" 플래그를 대체한다 -- 소스마다 커버리지가
        # 달라서 하나의 불리언으로는 화면의 빈 칸을 설명할 수 없다.
        "quote_sources": sources,
        "daily_pnl": {
            "total": portfolio["total"],
            "mtm": portfolio["mtm"],
            "theta": portfolio["theta"],
            "mtm_complete": portfolio["mtm_complete"],
        },
        "by_book": by_book,
    }


def build_book_summary(
    positions: list[PositionData],
    snapshot: MarketSnapshot,
    fixings: dict[date, float]
) -> list[dict]:
    """Per-book bond summary (notional, weighted YTM, hedged duration, sector /
    maturity allocation, top+bottom 3 by valuation).

    Took a `daily_pnl_by_book` argument until now that no line of the body ever
    read. It cost more than a dead parameter normally would: the frontend
    honoured it by waiting for /book-daily-pnl to return, then POSTing that
    whole result back here just to satisfy the signature -- which serialised
    two independent panels into a waterfall for nothing. The endpoint still
    ACCEPTS the field (unknown-field tolerant) so an older client doesn't
    break; it just no longer waits to send it.
    """
    books = {p.book for p in positions if p.instrument_type == "bond"}
    result = []

    credit_shifts = _credit_shifts()

    irs_positions = [p for p in positions if p.instrument_type == "irs"]
    irs_pvbp_by_book = {b: 0.0 for b in books}
    if irs_positions:
        swaps = [_to_swap(p) for p in irs_positions]
        try:
            delta_result = _shared_delta(snapshot, swaps, fixings)
            pid_to_book = {p.position_id: p.book for p in irs_positions}
            for pd in delta_result.position_deltas:
                p_book = pid_to_book[pd.position_id]
                if p_book in irs_pvbp_by_book:
                    irs_pvbp_by_book[p_book] += pd.total_delta
        except Exception as e:
            logger.error("Error computing IRS PVBP for summary: %s", e)

    for book in books:
        bonds = [p for p in positions if p.instrument_type == "bond" and p.book == book]
        total_notional = sum(p.notional or 0.0 for p in bonds)
        total_eval_amt = sum(p.evaluation_amount or 0.0 for p in bonds)
        
        weighted_ytm = 0.0
        if total_eval_amt > 0:
            weighted_ytm = sum((p.mtm_yield or 0.0) * (p.evaluation_amount or 0.0) for p in bonds) / total_eval_amt
            
        bond_pvbp = sum(p.pvbp or 0.0 for p in bonds)
        # pay_fixed=False is "receive fixed" which is long. pay_fixed=True is "pay fixed" which is short.
        # But price_portfolio_delta already returns signed delta. A receive-fixed swap has positive PV01.
        # So we just add IRS PVBP (which is total_delta) to bond_pvbp.
        net_pvbp = bond_pvbp + irs_pvbp_by_book[book]
        hedged_duration = (net_pvbp * 10000) / total_eval_amt if total_eval_amt > 0 else 0.0
        
        sector_totals = defaultdict(float)
        for p in bonds:
            sector_totals[p.sector] += (p.evaluation_amount or 0.0)
            
        sector_allocation = {}
        if total_eval_amt > 0:
            sector_allocation = {k: (v / total_eval_amt) * 100 for k, v in sector_totals.items()}
            
        matur_buckets = {b: 0.0 for b in allocation_history_service.MATURITY_BUCKETS}
        for p in bonds:
            yr = (p.remaining_days or 0) / 365.0
            matur_buckets[allocation_history_service.maturity_bucket(yr)] += (p.evaluation_amount or 0.0)
                
        maturity_allocation = {}
        if total_eval_amt > 0:
            maturity_allocation = {k: (v / total_eval_amt) * 100 for k, v in matur_buckets.items()}
            
        # Top3 / Bottom3 by bondValuation
        bond_valuations = []
        for p in bonds:
            shift_bp = 0.0
            if p.sector in credit_shifts and p.tenor_bucket in credit_shifts[p.sector]:
                shift_bp = credit_shifts[p.sector][p.tenor_bucket]
            val = (p.pvbp or 0.0) * (-shift_bp)
            bond_valuations.append({"position_id": p.position_id, "valuation": val})
            
        bond_valuations.sort(key=lambda x: x["valuation"], reverse=True)
        top3 = bond_valuations[:3]
        bottom3 = list(reversed(bond_valuations[-3:])) if len(bond_valuations) >= 3 else list(reversed(bond_valuations))
        
        result.append({
            "book": book,
            "totalNotional": total_notional,
            "totalEvaluationAmount": total_eval_amt,
            "weightedAvgYTM": weighted_ytm,
            "hedgedDuration": hedged_duration,
            "sectorAllocation": sector_allocation,
            "maturityAllocation": maturity_allocation,
            "top3": top3,
            "bottom3": bottom3,
        })
        
    result.sort(key=lambda x: x["book"])
    return result
