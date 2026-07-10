/**
 * Shared shape for "restorable dockview panel" definitions -- used by
 * whichever workspace registers itself with useWorkspacePanelsStore, and by
 * the left sidebar's accordion (src/stores/workspace-panels-store.ts) which
 * renders the toggle list and calls reopenPanel/close on the registered api.
 */
import type { DockviewApi } from "dockview-react";

export interface ManagedPanelDef {
  id: string;
  title: string;
  component: string;
  /** Existing panel id to dock next to when re-adding a closed panel. If that
   * panel isn't currently open either, the new panel is just added without a
   * position (dockview picks a sensible default) rather than erroring. */
  referencePanelId?: string;
  direction?: "left" | "right" | "above" | "below" | "within";
}

export function reopenPanel(api: DockviewApi, def: ManagedPanelDef) {
  const reference = def.referencePanelId ? api.getPanel(def.referencePanelId) : undefined;
  api.addPanel({
    id: def.id,
    component: def.component,
    title: def.title,
    position: reference ? { referencePanel: def.referencePanelId!, direction: def.direction ?? "right" } : undefined,
  });
}

export function togglePanel(api: DockviewApi, def: ManagedPanelDef) {
  const existing = api.getPanel(def.id);
  if (existing) existing.api.close();
  else reopenPanel(api, def);
}
