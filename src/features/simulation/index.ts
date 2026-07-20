/**
 * Public surface of the simulation slice. Under the ESLint boundary rule, the rest
 * of the app may only reach the slice through this barrel, and only from the
 * sanctioned mount point (the Simulation tab/route, wired in Phase 3).
 *
 * The screen surface is the four dockview panel bodies exported below (the S5
 * lightweight-charts rewrite). The Phase-1 recharts staging files
 * (scenario-simulator.tsx / scenario-preview-chart.tsx) were superseded by those
 * panels and deleted in S3 — recharts was never a target dependency.
 */

// Data port contract + client-state types
export type {
  SimulationDataPort,
  SimulationInputs,
  ScenarioParams,
  RunStatus,
} from "./types/simulation-port";
export { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "./types/simulation-port";

// Wire DTOs
export type {
  SimulateRequest,
  SimulateResponse,
  SimulationSummary,
  SimulationChartPoint,
  SimulationExclusion,
  TotalReturnDecomposition,
  Waypoint,
  IrsParRate,
} from "./api/simulate-dto";

// Domain types owned by the slice (Class B)
export type {
  Position,
  ShockCurves,
  FundingEvent,
  PVBPSensitivity,
  BookDailyPnL,
} from "./types/portfolio";

// Store (client state) + cross-screen selectors
export {
  useSimulationDataStore,
  selectSimulationResults,
  selectSimulationStatus,
  selectScenarioParams,
} from "./store/simulation-data-store";

// Server state (TanStack Query) + assembled port
export { useSimulationPort, useRunSimulation, SIMULATION_KEYS } from "./hooks/use-simulation";
export { simulationApi, SIMULATION_API_BASE } from "./api/simulation-api";

// Screen surface (s15 T3): the staged single flow — Configure → Running →
// Results — mounted by the app-layer tab host. It supersedes the four dockview
// panel bodies; the chart panels remain exported for direct reuse/testing.
export { SimulationFlow } from "./components/simulation-flow";
export { CurveViewPanel } from "./components/panels/curve-view-panel";
// HARDEN-1: DistributionChartPanel (quantile fan) left the Results surface —
// replaced by the component-curves hero. Engine-side quantile capability and
// the sigma_bp request contract are untouched.
export { ComponentCurvesPanel } from "./components/panels/component-curves-panel";
