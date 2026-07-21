/**
 * SimulationDataPort — the ONLY contract the Simulation Screen consumes for its
 * data (protocol §1.3). The screen never touches the legacy source store shape,
 * the raw fetch, or a global app store: it reads/writes params + inputs and calls
 * run() through this port. Non-streaming by design (no tick channel) — the source
 * has a single POST /api/simulate request/response (Phase 0 runtime audit).
 *
 * Implemented by ../store/simulation-data-store.ts (client state) + assembled with
 * the TanStack Query mutation in ../hooks/use-simulation.ts (server transport).
 */
import type { Position, ShockCurves } from "./portfolio";
import type { IrsParRate, SimulateRequest, SimulateResponse, Waypoint } from "../api/simulate-dto";

export type RunStatus = "idle" | "running" | "success" | "error";

/** N1 — the pillar the designed path/target pins (국고 curve). Owner-fixed
 * choice set; 3Y is the legacy anchor and the default. */
export type AnchorTenor = "1Y" | "3Y" | "5Y" | "10Y";
export const ANCHOR_TENOR_CHOICES: readonly AnchorTenor[] = ["1Y", "3Y", "5Y", "10Y"];

/**
 * Ambient inputs the screen depends on but does NOT own — supplied by the host
 * (in the source these arrive as props on <ScenarioSimulator>, fed by the Excel
 * upload pipeline). In the target these are pushed in via setInputs() by whatever
 * mounts the tab (Phase 3), or later sourced from the app's portfolio store.
 */
export interface SimulationInputs {
  positions: Position[];
  baseDate: string;
  /** s15 — optional and normally ABSENT: the live bridge no longer supplies a
   * funding rate, so the payload omits fundingRate and the backend derives it
   * from its 기준금리+10bp constant (the single source). Set only to reproduce
   * legacy explicit-funding payloads. */
  fundingRate?: number;
  dailyShockCurves: ShockCurves;
  irsParRates: IrsParRate[];
}

/**
 * User-editable scenario parameters. Numeric fields are kept as strings where the
 * source keeps them as free-text inputs (converted at request-build time, mirroring
 * the source's toNum()), so the port faithfully represents what the UI edits.
 */
export interface ScenarioParams {
  simDays: number;
  baseShockBp: string;
  waypoints: Waypoint[];
  spread1y: string;
  spread10y: string;
  spread30y: string;
  creditSpreads: Record<string, string>;
  irsSpread: string;
  shortEndEvents: { id: number; date: string; shiftBp: string }[];
  /** s13 — fan-chart σ in bp/√business-day (free-text like the other numeric
   * params; sanitized to (0, 25] at request-build time, backend default 2.0). */
  sigmaBp: string;
  /** SIM2-5 (ruling ④) — opt-in 금통위 funding stepping (default off = the
   * s15 fixed constant, byte-identical). Rides the payload as fundingStepping. */
  fundingStepping: boolean;
  /** SIM2-2 (ruling ①) — the intermediate waypoint days the USER has edited
   * (stepper, typed commit, or drag). Explicit flags, never value-equality
   * inference: an untouched waypoint re-lerps onto the line toward
   * {simDays, baseShockBp} on every horizon/target change; a touched one is
   * byte-preserved. Not read by buildSimulateRequest (payload unchanged). */
  touchedWaypointDays: number[];
  /** N1 — which 국고 pillar the target/waypoints/drag design (owner ruling:
   * 1Y/3Y/5Y/10Y, default 3Y). The WIRE stays 3Y-normalized: at request-build
   * time the design is re-expressed via base_wire = X − s_rel(τa) (tenor
   * spreads stay defined vs 3Y — the anchor moves the path, not the spread
   * reference). Anchor 3Y ⇒ the conversion is the identity ⇒ pre-N1 payloads
   * byte-for-byte (golden pin). OPTIONAL: absent ≡ "3Y" everywhere (old
   * in-memory param states and pre-N1 fixtures stay valid and identical). */
  anchorTenor?: AnchorTenor;
}

export interface SimulationDataPort {
  /** Ambient, host-provided inputs. */
  inputs: SimulationInputs;
  /** User-edited scenario parameters. */
  params: ScenarioParams;
  /** Result of the most recent successful run (also the cross-screen selector source). */
  lastRun: SimulateResponse | null;
  /** Exact request that produced `lastRun` (curve-preview reuse). */
  lastRunRequest: SimulateRequest | null;
  status: RunStatus;
  error: string | null;

  setInputs: (inputs: Partial<SimulationInputs>) => void;
  patchParams: (patch: Partial<ScenarioParams>) => void;
  resetParams: () => void;

  /**
   * Execute one scenario from a fully-assembled request. Returns the result, or null
   * on failure (error text is placed on `error`). Owns transport + result state.
   */
  run: (request: SimulateRequest) => Promise<SimulateResponse | null>;

  /**
   * Execute the current scenario: assembles the /api/simulate request from `inputs` +
   * `params` (via lib/scenario-curves buildSimulateRequest) and runs it. The screen
   * only sets params and calls this — it never builds the wire payload (§1.3).
   */
  runCurrent: () => Promise<SimulateResponse | null>;

  /**
   * s15 — abort the in-flight run (Running interstitial's cancel). Status returns
   * to idle; the previous result is kept (replace-on-arrival, no history).
   */
  cancelRun: () => void;
}

export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  simDays: 180,
  baseShockBp: "30",
  waypoints: [
    { day: 0, bp: 0 },
    { day: 180, bp: 30 },
  ],
  spread1y: "0",
  spread10y: "0",
  spread30y: "0",
  creditSpreads: { 특은채: "0", 은행채: "0", 카드채: "0", 회사채: "0" },
  irsSpread: "0",
  shortEndEvents: [],
  sigmaBp: "2.0",
  fundingStepping: false,
  touchedWaypointDays: [],
  anchorTenor: "3Y",
};

export const EMPTY_SIMULATION_INPUTS: SimulationInputs = {
  positions: [],
  baseDate: "",
  // fundingRate deliberately absent (s15): omitted → backend constant.
  dailyShockCurves: { bondCurves: {}, swapCurve: [] },
  irsParRates: [],
};
