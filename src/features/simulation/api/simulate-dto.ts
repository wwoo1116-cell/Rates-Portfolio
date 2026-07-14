/**
 * Wire DTOs for the Simulation Screen's single backend endpoint: POST /api/simulate.
 *
 * Shapes are transcribed from the source's real request/response usage
 * (rates-simulator-main: components/ScenarioSimulator.tsx runSimulation() and
 * hooks/usePortfolioMetrics.ts). There is NO streaming / websocket variant — this
 * endpoint is a single request/response (confirmed in the Phase 0 runtime audit).
 */
import type {
  BookDailyPnL,
  FundingEvent,
  Position,
  PVBPSensitivity,
  ShockCurves,
} from "../types/portfolio";

export interface Waypoint {
  day: number;
  bp: number;
}

export interface IrsParRate {
  t: number;
  rate: number;
  maturityDate?: string;
  tenor?: string;
}

/** Request body of POST /api/simulate. Mirrors the source payload exactly. */
export interface SimulateRequest {
  positions: Position[];
  shockCurves: ShockCurves;
  dailyShockCurves: ShockCurves;
  fundingRate: number;
  fundingEvents: FundingEvent[];
  simDays: number;
  shockType: "ramp" | "step";
  shockMode: "matrix" | "parallel";
  baseShockBp: number;
  baseDate: string;
  irsCurves: IrsParRate[];
  customPath?: Waypoint[];
}

export interface SimulationSummary {
  finalMTM: number;
  finalCarry: number;
  finalSwap: number;
  finalTotal: number;
  breakEvenDay: number;
}

/** One point on the Total-Return trace. `day` is always present; the remaining
 * numeric series keys (mtmPnL, cumulativeCarry, swapThetaPnL, swapValuationPnL,
 * totalPnL) and the optional `bokBreakdown` block vary, so the row stays open. */
export interface SimulationChartPoint {
  day: number;
  [key: string]: unknown;
}

/** Response body of POST /api/simulate. */
export interface SimulateResponse {
  chartData: SimulationChartPoint[];
  summary: SimulationSummary;
  irsSettlementEvents?: unknown[];
  irsDailyReconciliation?: unknown[];
  pvbpSensitivity?: PVBPSensitivity[];
  bookDailyPnLs?: BookDailyPnL[];
}
