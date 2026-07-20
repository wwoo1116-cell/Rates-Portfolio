import { SimulationTab } from "./simulation-tab";

/**
 * S7 — the migrated dockview Simulation screen is now the sole path (placeholder
 * removed from the route; `NEXT_PUBLIC_SIMULATION_V2` flag retired).
 *
 * The legacy pricer-sandbox files (features/simulation/{pricer-page,impact-grid,
 * trade-entry}.tsx + stores/simulation-store.ts) are left ON DISK but orphaned
 * (imported by nothing) — physical removal deferred to R3 (simulation-workspace.tsx,
 * the family's former root, was deleted in R2 per the approved orphan list).
 * Rollback lives in git (this is on feat/simulation-migration).
 */
export default function SimulationPage() {
  return <SimulationTab />;
}
