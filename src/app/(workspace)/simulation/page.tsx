import { SimulationTab } from "./simulation-tab";

/**
 * S7 — the migrated dockview Simulation screen is now the sole path (placeholder
 * removed from the route; `NEXT_PUBLIC_SIMULATION_V2` flag retired).
 *
 * The legacy pricer-sandbox files (features/simulation/{pricer-page,impact-grid,
 * trade-entry}.tsx + stores/simulation-store.ts + lib/placeholder-data/pricer.ts),
 * orphaned since R2 (simulation-workspace.tsx, the family's former root, was
 * deleted then), were physically removed in R3B-PLUS A1. Rollback lives in git.
 */
export default function SimulationPage() {
  return <SimulationTab />;
}
