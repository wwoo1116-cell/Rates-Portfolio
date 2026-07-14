/**
 * Public surface of the simulation slice. Under the ESLint boundary rule, the rest
 * of the app may only reach the slice through this barrel, and only from the
 * sanctioned mount point (the Simulation tab/route, wired in Phase 3).
 *
 * Phase 1 exposes the READY state/data layer. The screen components
 * (./components/scenario-simulator, ./components/scenario-preview-chart) are staged
 * but NOT exported yet — they are recharts-based and @ts-nocheck pending the Phase 2
 * chart rewrite + token restyle. They get exported here once they're active.
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

// Dockview panel bodies (Phase 3). Pure, port-driven; the app-layer mount host
// composes them into the dockview tab. Chart panels are staged for the S5
// recharts -> lightweight-charts rewrite.
export { ScenarioConfigPanel } from "./components/panels/scenario-config-panel";
export { ResultsGridPanel } from "./components/panels/results-grid-panel";
export { CurveViewPanel } from "./components/panels/curve-view-panel";
export { DistributionChartPanel } from "./components/panels/distribution-chart-panel";
