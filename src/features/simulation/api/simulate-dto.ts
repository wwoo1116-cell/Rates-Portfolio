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
  /** s15 — OMITTED by the live bridge: the backend then derives funding as its
   * 기준금리+10bp constant, fixed for the whole horizon (no 금통위 stepping).
   * Sending an explicit value keeps the legacy source semantics (value +
   * fundingEvents stepping) — used only by old payloads/tests. */
  fundingRate?: number;
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
  /** SIM2-5 (ruling ④, additive) — true + omitted fundingRate: fixed-mode
   * funding STEPS at the request's 금통위 events (base = the policy constant
   * pair). false/omitted = the s15 constant, byte-identical. */
  fundingStepping?: boolean;
  /** Whether the backend should compute the percentile fan (`distribution`).
   * Omitted/true = legacy behaviour. FALSE is what this app ships: the fan costs
   * FOUR extra full-book engine runs (the backend's "scenario-expansion (4 runs)"
   * phase re-runs the whole chart build per percentile) and this UI no longer
   * renders it — see components/panels/component-curves-panel.tsx. On the live
   * book that was the difference between ~6 minutes and seconds. */
  includeDistribution?: boolean;
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
 * (0.0285 = 2.85%); positionRate/carryBp are null (unknown, not zero) when no
 * live bonds remain at that step. s15: with fundingRate omitted from the
 * request, fundingRate here is the backend's 기준금리+10bp constant on every
 * row, and carryBp === (positionRate − fundingRate) × 1e4. */
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
 * simulation_service.build_distribution_bands for the documented assumptions).
 *
 * s18 T3 (dual-axis separation): the p-keys of `bands` are RETURN trajectories
 * keyed to their generating RATE-quantile scenario — they are NOT outcome
 * ranks and may cross on non-monotone books; render them as per-scenario
 * LINES labeled by scenario (금리 P95 시나리오), never as rank bands.
 * `ratePaths` carries each scenario's 국채 **3Y-관측** cumulative-bp path (the
 * 3.0-year cross-section of the shocked 국채 curve, chart.py `_ktb3y_bp`) —
 * N1/T2: this stays a 3Y OBSERVATION under any designed anchor; a revived
 * consumer must label it "3Y 관측", never as the designed-anchor path. Rates are
 * monotone in the quantile by construction, so THOSE bands never cross and
 * P5..P95 labels are truthful there. Optional: older cached responses lack it. */
export interface SimulationDistribution {
  sigmaBpDaily: number;
  sigmaTerminalBp: number;
  percentiles: number[];
  method: string;
  bands: DistributionBand[];
  ratePaths?: DistributionBand[];
}

/** s15 T2 — explicit asset-class exclusion. An excluded class renders as a
 * notice + blank (—) line, NEVER as a numeric zero (blank-MtM policy). */
export interface SimulationExclusion {
  assetClass: string;
  reason: string;
  asOf: string;
}

/** s15 T2 — horizon Total Return decomposition (unrounded KRW floats).
 * bondMtm + bondCarry + fundingCost + swapMtm + swapCarry === final totalPnL
 * (±₩1, pinned server-side). swapMtm/swapCarry are null when swaps were
 * excluded (unknown, not zero). */
/** SIM2-7 — funding-basis provenance (see SimulateResponse.fundingBasis). */
export interface FundingBasis {
  seriesStart: string | null;
  joinDate: string | null;
  seriesLatestRate: number | null;
  policyRate: number;
  spreadBp: number;
  stale: boolean;
  applied: boolean;
}

/** HARDEN-1 — one day of the cumulative component decomposition (unrounded
 * KRW floats, swap split on the theta/valuation axis like the final
 * decomposition). swapMtm/swapCarry are null when swaps were excluded. */
export interface DecompositionDailyPoint {
  day: number;
  fundingCost: number;
  bondMtm: number;
  bondCarry: number;
  swapMtm: number | null;
  swapCarry: number | null;
  total: number;
}

export interface TotalReturnDecomposition {
  bondMtm: number;
  bondCarry: number;
  fundingCost: number;
  swapMtm: number | null;
  swapCarry: number | null;
  total: number;
}

/** RECON-SCEN — one refixing settlement the engine's FM path produced
 * (chart.py scf_s collection): the projected net settlement cash of one swap
 * on one day under SCENARIO fixings. Sign: receive-fixed collects
 * (fixed − float). These fields were always on the wire (backend
 * IrsSettlementEvent model, simulate.py) — previously typed `unknown`. */
export interface IrsSettlementEvent {
  day: number;
  date: string | null;
  positionName: string;
  positionId: string;
  notional: number;
  direction: number;
  fixedRate: number;
  settledCf: number;
}

/** RECON-SCEN — one business day of the engine's internal IRS daily recon
 * loop (SIM2-4 aligned; backend IrsDailyReconRow, simulate.py): per-tenor
 * daily KRD (`pvbp`), the applied cumulative/daily Δbp per tenor, the
 * per-tenor linear P&L estimate, and the actual-vs-estimate lanes. NOTE the
 * `residual` here is the engine's DAILY-linearization residual (actual −
 * Σ −pvbp(day)×dailyΔbp) — related to but not the same object as the
 * baseDate-KRD 잔차 path the 시나리오 대사 view derives (scenario-recon.ts). */
export interface IrsDailyReconRow {
  date: string;
  day: number;
  pvbp: Record<string, number>;
  cumulativeBp: Record<string, number>;
  dailyDbp: Record<string, number>;
  pnl: Record<string, number>;
  totalEstPnl: number;
  totalActual: number;
  settleCf: number;
  npvChange: number;
  residual: number;
  thetaPnl: number;
  valuationPnl: number;
}

/** Response body of POST /api/simulate. */
export interface SimulateResponse {
  chartData: SimulationChartPoint[];
  summary: SimulationSummary;
  irsSettlementEvents?: IrsSettlementEvent[];
  irsDailyReconciliation?: IrsDailyReconRow[];
  pvbpSensitivity?: PVBPSensitivity[];
  bookDailyPnLs?: BookDailyPnL[];
  // s11 additive fields — optional so cached/older responses stay valid.
  fundingCurve?: FundingCurvePoint[];
  distribution?: SimulationDistribution | null;
  // s15 additive fields — same optionality rationale.
  exclusions?: SimulationExclusion[];
  totalReturnDecomposition?: TotalReturnDecomposition;
  // HARDEN-1 additive field — per-day cumulative five-component paths (the
  // Results component-curves hero). Same accumulators as the decomposition:
  // per day fundingCost + bondMtm + bondCarry + swapMtm + swapCarry == total
  // (±₩1 pinned server-side); final day == totalReturnDecomposition. Swap
  // components are null per day when swaps were excluded (blank policy).
  decompositionDaily?: DecompositionDailyPoint[];
  // SIM2-7 additive field — funding-basis provenance: historical BOK stairs
  // within series coverage (through joinDate), the policy constant beyond,
  // SIM2-5 events on top. `applied` only for fixed-mode (omitted fundingRate)
  // runs; `stale` = series latest disagrees with the policy constant.
  fundingBasis?: FundingBasis;
}
