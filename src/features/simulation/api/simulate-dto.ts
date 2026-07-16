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
  /** s13 — fan-chart σ in bp/√business-day. Optional; backend defaults to 2.0
   * (byte-identical to the s11 constant) and 422s outside (0, 25]. */
  sigma_bp?: number;
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

/** s11 T4 — funding rate along the simulation time axis. Rates are decimals
 * (0.042 = 4.2%); positionRate/carryBp are null (unknown, not zero) when no
 * live bonds remain at that step. */
export interface FundingCurvePoint {
  day: number;
  date: string;
  fundingRate: number;
  positionRate: number | null;
  carryBp: number | null;
}

export interface DistributionBand {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/** s11 T3 — totalPnL percentile fan. p50 equals the base scenario's totalPnL
 * trace; each band is a real engine run of the scenario plus a parallel shock
 * ramping to its terminal quantile offset (see backend
 * simulation_service.build_distribution_bands for the documented assumptions). */
export interface SimulationDistribution {
  sigmaBpDaily: number;
  sigmaTerminalBp: number;
  percentiles: number[];
  method: string;
  bands: DistributionBand[];
}

/** Response body of POST /api/simulate. */
export interface SimulateResponse {
  chartData: SimulationChartPoint[];
  summary: SimulationSummary;
  irsSettlementEvents?: unknown[];
  irsDailyReconciliation?: unknown[];
  pvbpSensitivity?: PVBPSensitivity[];
  bookDailyPnLs?: BookDailyPnL[];
  // s11 additive fields — optional so cached/older responses stay valid.
  fundingCurve?: FundingCurvePoint[];
  distribution?: SimulationDistribution | null;
}
