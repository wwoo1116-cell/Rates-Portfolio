"""Wire DTOs for /api/simulate — moved verbatim from simulation_service.py (R3a).

These live here rather than in api/models.py because their camelCase field
names ARE the frozen frontend contract (krw-fi-pms
src/features/simulation/api/simulate-dto.ts) — they are not reusable
snake_case API models, and the ported functions read them by attribute
exactly as the source did.
"""

from __future__ import annotations

from pydantic import BaseModel


class FrontendPosition(BaseModel):
    id: str = ""
    name: str = ""
    book: str = ""
    bondType: str = "bond"              # 'swap' | 'bond'
    sector: str = ""
    maturityDate: str | None = None
    couponRate: float = 0.0
    frequency: int = 2
    notional: float = 0.0
    entryYield: float = 0.0
    evaluationAmount: float = 0.0
    duration: float = 0.0
    pvbp: float = 0.0
    tenor: str = ""
    remainingDays: float = 0.0
    krdMap: dict[str, float] = {}
    mtmYield: float | None = None
    expectedThetaPnL: float | None = None
    direction: float = 1.0          # IRS: +1=receive-fixed, -1=pay-fixed / Bond: +1=long
    currentFloatRate: float = 0.0   # IRS 현재 구간 변동금리 (% 단위, e.g. 2.81)
    nextFixingDate: str | None = None   # IRS 다음 변동금리 픽싱/지급일 (ISO date string)
    startDate: str | None = None        # IRS 계약 시작일 (ISDA Forward Schedule 생성용)


class FrontendShockCurves(BaseModel):
    bondCurves: dict[str, list[dict]] = {}  # {섹터키: [{t, val}, ...]}
    swapCurve: list[dict] = []
    fundingEvents: list[dict] = []
