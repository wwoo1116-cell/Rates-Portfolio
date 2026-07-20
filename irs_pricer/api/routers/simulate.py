"""
POST /api/simulate — scenario P&L simulation, ported from rates-simulator-main.

The request/response shapes are the FROZEN frontend contract
(UIUX_test src/features/simulation/api/simulate-dto.ts, pinned by its MSW
contract test): camelCase field names, positions in the source's
FrontendPosition shape. Do not "normalise" these to snake_case.

Unlike the source (whose endpoint had no response model), the response is
typed below — SimulateResponse mirrors what run_simulation() actually returns,
with `SimulationChartPoint` left open (extra="allow") because the per-day rows
carry a varying set of series keys plus an optional bokBreakdown block, exactly
as the frontend DTO models it ([key: string]: unknown).

`def`, not `async def`: one simulate call is seconds of numpy/engine work (a
full-revaluation path per IRS position plus a per-business-day KRD rebuild).
See the NOTE in portfolio_analytics.py — an `async def` here would run that on
the event loop and stall every other endpoint for the duration.

Errors: engine crashes surface as the source's ValueError("FM Engine Crash …")
and deliberately stay 500s (via app.py's catch-all middleware, which keeps the
CORS header on) — they are server faults on valid input, not the 400-worthy
bad-input ValueErrors the other routers map.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from ...services import simulation_service
from ...services.simulation_service import FrontendPosition, FrontendShockCurves

router = APIRouter(prefix="/api")


class SimulateRequest(BaseModel):
    positions: list[FrontendPosition]
    shockCurves: FrontendShockCurves | None = None         # 시나리오 충격 (chartData 전용)
    dailyShockCurves: FrontendShockCurves | None = None    # 당일 실제 금리변동 (bookDailyPnL 전용)
    # s15 T1: 생략(None)이면 조달금리 = 기준금리 + 10bp 상수, 전 기간 고정 —
    # 이벤트 스테핑 없음 (simulation_service.POLICY_BASE_RATE_KRW /
    # FUNDING_SPREAD_BP가 유일한 원천; 라이브 브리지는 이 필드를 싣지 않는다).
    # 명시하면 원본 소스 의미론(그 값 + fundingEvents 계단 스테핑) 유지 —
    # 소스 골든 캡처(0.042 명시)의 패리티가 그 경로로 계속 검증된다.
    fundingRate: float | None = None
    fundingEvents: list[dict] = []
    simDays: int = 90
    shockType: str = "step"             # 'step' | 'ramp'
    shockMode: str = "parallel"         # 'parallel' | 'matrix'
    baseShockBp: float = 50.0
    baseDate: str = "2026-01-01"
    irsCurves: list[dict] = []          # [{t: float, rate: float, maturityDate?: str, tenor?: str}, ...] IRS Par Rate (decimal)
                                         # maturityDate(ISO, 실제 달력 만기일)가 있으면 t 대신 우선 사용.
                                         # 없고 tenor(예: "3m","1y")가 있으면 resolve_curve_maturity_dates가
                                         # base_date+tenor로 실제 만기일을 직접 계산해 채워 넣음(v5 포맷 대응)
    customPath: list[dict] = []         # [{day: int, bp: float}, ...] 웨이포인트 기반 커스텀 경로
    # s13 — 분포 팬의 σ (bp/√영업일). 생략 시 2.0 == s11의 상수와 바이트 동일.
    # 범위 밖(≤0, >25)은 422: σ=0은 폭 0의 "팬"(분포 주장으로서 거짓)이고,
    # 25bp/√일 초과는 어떤 KRW 금리 체계에서도 입력 실수다.
    sigma_bp: float = Field(default=2.0, gt=0, le=25)
    # SIM2-5 (ruling ④, 추가 전용): True + fundingRate 생략 → 고정 모드 조달이
    # 요청의 금통위 이벤트로 스테핑(base = 정책 상수 페어). 기본 False = 종전
    # 동작 바이트 동일. 명시적 fundingRate 경로(레거시 스테핑)에는 영향 없음.
    fundingStepping: bool = False


class SimulationChartPoint(BaseModel):
    """Total-Return 궤적의 하루치. `day` 외의 시리즈 키(mtmPnL, cumulativeCarry,
    swapPnL, totalPnL, swapThetaPnL, swapValuationPnL)와 BOK 이벤트 당일에만
    붙는 bokBreakdown은 열린 필드로 통과시킨다 — 프론트 DTO도 open row다."""
    model_config = ConfigDict(extra="allow")

    day: int


class SimulationSummary(BaseModel):
    finalMTM: int
    finalCarry: int
    finalSwap: int
    finalTotal: int
    breakEvenDay: int


class PvbpSensitivityRow(BaseModel):
    sector: str
    tenors: dict[str, float]   # KRD_NAMES 각 테너 + "합계"
    total: float


class BookDailyPnLRow(BaseModel):
    bookName: str
    dailyCarry: int
    fundingCost: int
    bondValuation: int
    swapValuation: int
    swapThetaPnL: int
    totalDailyPnL: int


class IrsSettlementEvent(BaseModel):
    day: int
    date: str | None
    positionName: str
    positionId: str
    notional: float
    direction: int
    fixedRate: float
    settledCf: int


class IrsDailyReconRow(BaseModel):
    date: str
    day: int
    pvbp: dict[str, int]
    cumulativeBp: dict[str, float]
    dailyDbp: dict[str, float]
    pnl: dict[str, int]
    totalEstPnl: int
    totalActual: int
    settleCf: int
    npvChange: int
    residual: int
    thetaPnl: int
    valuationPnl: int


class FundingCurvePoint(BaseModel):
    """s11 T4 — 시뮬레이션 타임스텝별 조달금리/포지션 운용수익률/캐리 bp.
    positionRate/carryBp는 살아있는 채권이 없으면 null (0이 아니라 미정의)."""
    day: int
    date: str
    fundingRate: float
    positionRate: float | None
    carryBp: float | None


class DistributionBand(BaseModel):
    day: int
    p5: float
    p25: float
    p50: float
    p75: float
    p95: float


class SimulationDistribution(BaseModel):
    """s11 T3 — totalPnL 퍼센타일 팬. p50은 기본 시나리오 궤적과 동일하고,
    각 밴드는 '시나리오 + 만기 Δp 평행 충격'의 실제 엔진 런이다
    (simulation_service.build_distribution_bands의 가정 주석 참조).

    s18 T3 (이중축 분리): bands의 p-키는 '생성 금리 분위수 시나리오'의 수익
    궤적이며 순위 라벨이 아니다 — FE는 라인 + 시나리오 라벨로 렌더링한다.
    ratePaths는 각 시나리오의 국채 3Y 누적 충격 경로(bp)로, 금리는 분위수에
    단조라 절대 교차하지 않는다 — P5..P95 라벨이 진실인 축은 이쪽이다."""
    sigmaBpDaily: float
    sigmaTerminalBp: float
    percentiles: list[int]
    method: str
    bands: list[DistributionBand]
    # s18 확장 필드 (추가 전용) — 금리 분위수 경로, bands와 같은 day 축.
    ratePaths: list[DistributionBand]


class SimulationExclusion(BaseModel):
    """s15 T2 — 명시적 자산군 제외. 제외된 자산군은 0이 아니라 '표시 없음'으로
    렌더링돼야 한다(blank-MtM 정책): FE Results가 reason을 그대로 공지로 띄우고
    해당 손익 라인을 공란 처리한다."""
    assetClass: str   # 현재 "swap"만 발생
    reason: str       # 예: "당일 IRS 호가 없음"
    asOf: str         # 기준일 (ISO)


class TotalReturnDecomposition(BaseModel):
    """s15 T2 — 만기 시점 Total Return 성분 분해(비라운딩 float, 원화).
    문서화된 라인 셋(최소·명확): bondMtm(채권 평가) + bondCarry(채권 이자수익
    + 만기 재투자 수익, 조달 차감 전 총액) + fundingCost(조달 비용, 음수) +
    swapMtm(IRS 평가) + swapCarry(IRS 캐리). 합 == chartData 최종 totalPnL
    (±₩1, 라운딩 차이만 — test_simulate_api가 고정). 스왑이 제외된 요청에서는
    swapMtm/swapCarry가 null(미정의)이고 total은 채권 성분 합이다.

    HARDEN-1: 스왑 성분은 채권과 대칭인 세타/평가 분해다 — swapCarry =
    세타손익(커브 base_date 고정·시간경과, chartData.swapThetaPnL의 비라운딩
    원본), swapMtm = 평가손익(전체 − 세타, chartData.swapValuationPnL의 원본).
    엔진 daily_carry(항상 0)를 그대로 노출하던 종전 swapCarry=0 분해를 대체;
    swapMtm+swapCarry 합·total·채권 성분·funding은 종전과 동일하다."""
    bondMtm: float
    bondCarry: float
    fundingCost: float
    swapMtm: float | None
    swapCarry: float | None
    total: float


class DecompositionDailyPoint(BaseModel):
    """HARDEN-1 — 일별 누적 Total Return 성분 분해(비라운딩 float, 원화).
    TotalReturnDecomposition과 같은 엔진 누적기에서 나온 같은 float들의 일별
    스냅샷: 매일 fundingCost + bondMtm + bondCarry + swapMtm + swapCarry ==
    total (±₩1 핀), 마지막 날 == totalReturnDecomposition. 스왑 성분은 세타/
    평가 대칭 분해(swapCarry = 세타손익, swapMtm = 평가손익); 스왑 제외 요청은
    swapMtm/swapCarry가 매일 null(blank 정책 — 게으른 0 금지)."""
    day: int
    fundingCost: float
    bondMtm: float
    bondCarry: float
    swapMtm: float | None
    swapCarry: float | None
    total: float


class FundingBasisOut(BaseModel):
    """SIM2-7 — 조달 기준 출처(프로버넌스). 고정 모드(fundingRate 생략)에서만
    applied=True: 시리즈 커버리지 내 날짜는 실적(BOK)+스프레드, 조인
    (joinDate) 이후는 정책 상수+스프레드, SIM2-5 이벤트는 그 위에 스택.
    stale = 시리즈 최신값 ≠ 정책 상수(시리즈가 결정에 뒤처짐)."""
    seriesStart: str | None
    joinDate: str | None
    seriesLatestRate: float | None
    policyRate: float
    spreadBp: int
    stale: bool
    applied: bool


class SimulateResponse(BaseModel):
    status: str
    chartData: list[SimulationChartPoint]
    summary: SimulationSummary
    pvbpSensitivity: list[PvbpSensitivityRow]
    bookDailyPnLs: list[BookDailyPnLRow]
    irsSettlementEvents: list[IrsSettlementEvent]
    irsDailyReconciliation: list[IrsDailyReconRow]
    # s11 확장 필드 — 기존 골든 계약에 대한 추가 전용(extend, don't mutate).
    fundingCurve: list[FundingCurvePoint]
    distribution: SimulationDistribution | None
    # s15 확장 필드 — 역시 추가 전용.
    exclusions: list[SimulationExclusion]
    totalReturnDecomposition: TotalReturnDecomposition
    # HARDEN-1 확장 필드 — 추가 전용: 일별 누적 성분 분해 경로.
    decompositionDaily: list[DecompositionDailyPoint]
    # SIM2-7 확장 필드 — 추가 전용: 조달 기준 프로버넌스.
    fundingBasis: FundingBasisOut


@router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> dict:
    return simulation_service.run_simulation(
        positions=req.positions,
        shock_curves=req.shockCurves,
        daily_shock_curves=req.dailyShockCurves,
        funding_rate=req.fundingRate,
        funding_events=req.fundingEvents,
        sim_days=req.simDays,
        shock_type=req.shockType,
        shock_mode=req.shockMode,
        base_shock_bp=req.baseShockBp,
        base_date=req.baseDate,
        irs_curves=req.irsCurves,
        custom_path=req.customPath,
        sigma_bp=req.sigma_bp,
        funding_stepping=req.fundingStepping,
    )
