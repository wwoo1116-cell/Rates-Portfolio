import { SimulationTab } from "./simulation-tab";
import { SimulationWorkspace } from "@/features/simulation/simulation-workspace";

/**
 * §4.3 rollback: the legacy pricer-sandbox placeholder (SimulationWorkspace) is
 * RETAINED behind this flag, not deleted, until the S7 checkpoint suite is green.
 * Default = the migrated dockview screen (adjustment #3: replace the tab, don't append).
 * Set NEXT_PUBLIC_SIMULATION_V2=0 to instantly fall back to the placeholder. S7 deletes
 * the legacy path and this switch.
 */
const USE_MIGRATED = process.env.NEXT_PUBLIC_SIMULATION_V2 !== "0";

export default function SimulationPage() {
  return USE_MIGRATED ? <SimulationTab /> : <SimulationWorkspace />;
}
