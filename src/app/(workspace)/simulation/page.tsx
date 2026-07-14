import { SimulationTab } from "./simulation-tab";

/**
 * S7 — the migrated dockview Simulation screen is now the sole path (placeholder
 * removed from the route; `NEXT_PUBLIC_SIMULATION_V2` flag retired).
 *
 * The legacy pricer-sandbox files (features/simulation/{simulation-workspace,
 * pricer-page,impact-grid,trade-entry}.tsx + stores/simulation-store.ts) are left
 * ON DISK but orphaned (imported by nothing), NOT deleted — `pricer-page.tsx` carries
 * uncommitted WIP, so physically removing them is left to a follow-up once that WIP is
 * committed. Rollback now lives in git (this is on feat/simulation-migration), gated on
 * your review since the §4.2 visual checkpoints aren't wired yet (Playwright deferred).
 */
export default function SimulationPage() {
  return <SimulationTab />;
}
