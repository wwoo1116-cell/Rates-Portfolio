"""s15 T2 swap market-data resolution + explicit exclusions — moved verbatim
from simulation_service.py (R3a).

Monkeypatch seam (SPLIT_PLAN H4): tests patch
simulation_service.market_data_service.load_snapshot/load_fixings — that
lands on the shared market_data_service MODULE object, so this module must
call through the module attribute (market_data_service.load_snapshot(...)),
never bind the functions at import time.
"""

from __future__ import annotations

import logging
from datetime import date

from ...core.errors import NonBusinessDayError
from ...engine import quant_engine as qe
from ...engine.fixings import select_fixing
from .. import market_data_service
from .kr_calendar import _TENOR_MONTHS
from .models import FrontendPosition

logger = logging.getLogger(__name__)


# ── s15 T2: 스왑 시장 데이터 결정 (IRS par 커브 + 픽싱) ───────────────────────

_MONTHS_TO_TENOR = {m: lbl for lbl, m in _TENOR_MONTHS.items()}

# 명시적 제외 사유 — FE Results 표면이 그대로 렌더링하는 문자열.
SWAP_EXCLUSION_REASON_NO_QUOTES = "당일 IRS 호가 없음"


def _resolve_swap_inputs(
    positions: list[FrontendPosition],
    irs_curves: list[dict],
    base_date_str: str,
) -> tuple[list[FrontendPosition], list[dict], list[dict]]:
    """스왑이 포함된 요청의 시장 데이터 결정. (positions, irs_curves, exclusions) 반환.

    브리지(S6)는 irsCurves를 싣지 않는다 — 스왑 포지션이 있고 irsCurves가 비어
    있으면 백엔드의 IRS 스냅샷 저장소(market_data_service.load_snapshot)에서
    base_date **당일** par 호가를 가져온다. 소유자 결정: 당일 호가가 없으면
    폴백 스냅샷도, 침묵의 0도 없다 — 스왑을 명시적으로 제외하고(exclusions
    항목 + 포지션 제거) 나머지 채권 산출은 정상 진행한다. 요청이 irsCurves를
    직접 실으면(구형/테스트 페이로드) 그대로 존중한다.

    유지되는 제약: par 커브가 비어도 500이 나지 않는다 — build_chart_data의
    문서화된 의도적 분기(빈 대사표)는 이제 "스왑 없는 북 + 커브 없음"의
    순수 부재 케이스에서만 도달한다.
    """
    has_swaps = any(p.bondType == "swap" for p in positions)
    if not has_swaps or irs_curves:
        return positions, irs_curves, []

    try:
        base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        base_date = date.today()

    snapshot = None
    try:
        snapshot = market_data_service.load_snapshot(base_date)
    except (NonBusinessDayError, ValueError) as e:
        logger.warning("[s15 T2] base_date=%s IRS 호가 없음 → 스왑 제외: %s", base_date, e)

    resolved: list[dict] = []
    if snapshot is not None:
        for q in snapshot.swap_quotes:
            months = q.tenor_months if q.tenor_months is not None else int(q.tenor_years) * 12
            entry: dict = {"t": months / 12.0, "rate": q.rate}
            lbl = _MONTHS_TO_TENOR.get(months)
            if lbl:
                # 테너 라벨을 실어 resolve_curve_maturity_dates가 실제 만기일
                # (Modified Following)을 계산하게 한다 — 라벨 T보다 정확.
                entry["tenor"] = lbl
            resolved.append(entry)

    # 스냅샷 자체가 없거나(예외) 있어도 IRS 호가가 0건이면 동일하게 "당일 호가
    # 없음" — 빈 par 커브로 FM 경로에 들어가 500이 나는 대신 명시적 제외.
    if not resolved:
        exclusions = [{
            "assetClass": "swap",
            "reason": SWAP_EXCLUSION_REASON_NO_QUOTES,
            "asOf": base_date.isoformat(),
        }]
        return [p for p in positions if p.bondType != "swap"], irs_curves, exclusions
    return positions, resolved, []


def _resolve_swap_float_fields(
    positions: list[FrontendPosition],
    base_date_str: str,
) -> list[FrontendPosition]:
    """스왑 포지션의 미충전 시장 필드(currentFloatRate, nextFixingDate,
    remainingDays)를 백엔드에서 채운다. 브리지의 ManualPosition은 계약 조건
    (시작/만기/고정금리/방향)만 알고 현재 구간 변동금리는 모른다.

    같은 원천 사용: 스케줄은 qe.IRS_Trade(FM 경로가 쓰는 그 ISDA 스케줄),
    픽싱은 engine/fixings.select_fixing(실북 MtM 경로 value_booked_trade와
    동일한 리셋일 기준 F(R)=R−1 서울영업일 규칙) + market_data_service.load_fixings.
    이미 값이 채워져 온 포지션(구형 페이로드·테스트)은 건드리지 않는다.
    """
    swaps = [p for p in positions if p.bondType == "swap"]
    if not swaps:
        return positions
    try:
        base_date = date.fromisoformat(str(base_date_str)[:10])
    except Exception:
        base_date = date.today()

    # 픽싱 이력은 실제로 해결할 변동금리가 있을 때만 로드 — 모든 필드가 이미
    # 채워진 페이로드(구형/골든/프리즈드 픽스처)는 데이터 저장소를 건드리지 않는다.
    fixings: dict = {}
    if any(not p.currentFloatRate for p in swaps):
        try:
            fixings = market_data_service.load_fixings()
        except Exception:
            logger.warning("[s15 T2] CD 픽싱 이력 로드 실패 — currentFloatRate 미해결", exc_info=True)

    out: list[FrontendPosition] = []
    for p in positions:
        if p.bondType != "swap":
            out.append(p)
            continue
        updates: dict = {}
        try:
            mat = date.fromisoformat(str(p.maturityDate)[:10]) if p.maturityDate else None
            if mat is not None and not p.remainingDays:
                updates["remainingDays"] = float(max((mat - base_date).days, 0))
            start = date.fromisoformat(str(p.startDate)[:10]) if p.startDate else None
            if start is not None and mat is not None and mat > start:
                trade = qe.IRS_Trade(
                    start, mat, p.couponRate or 0.0,
                    int(p.direction or 1), p.notional or 0.0, sector=p.sector or "IRS",
                )
                future = [d for d in trade.pay_dates if d > base_date]
                if future:
                    nfd = future[0]
                    if not p.nextFixingDate:
                        updates["nextFixingDate"] = nfd.isoformat()
                    if not p.currentFloatRate and fixings:
                        idx = trade.pay_dates.index(nfd)
                        reset = trade.pay_dates[idx - 1] if idx > 0 else trade.start_date
                        res = select_fixing(fixings, reset, base_date)
                        if res is not None and res.rate is not None:
                            updates["currentFloatRate"] = res.rate * 100.0
                            if res.is_data_quality_event:
                                logger.warning(
                                    "[s15 T2] 픽싱 데이터 품질 이벤트 (pos=%s): %s",
                                    p.id or p.name, res.to_payload(),
                                )
        except Exception:
            logger.warning("[s15 T2] 스왑 시장 필드 해결 실패 (pos=%s)", p.id or p.name, exc_info=True)
        out.append(p.model_copy(update=updates) if updates else p)
    return out
