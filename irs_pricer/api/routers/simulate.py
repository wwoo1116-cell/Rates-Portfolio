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
from pydantic import BaseModel, ConfigDict

from ...services import simulation_service
from ...services.simulation_service import FrontendPosition, FrontendShockCurves

router = APIRouter(prefix="/api")


class SimulateRequest(BaseModel):
    positions: list[FrontendPosition]
    shockCurves: FrontendShockCurves | None = None         # 시나리오 충격 (chartData 전용)
    dailyShockCurves: FrontendShockCurves | None = None    # 당일 실제 금리변동 (bookDailyPnL 전용)
    fundingRate: float = 0.042
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
    (simulation_service.build_distribution_bands의 가정 주석 참조)."""
    sigmaBpDaily: float
    sigmaTerminalBp: float
    percentiles: list[int]
    method: str
    bands: list[DistributionBand]


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
    )
