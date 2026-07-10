import { create } from "zustand";
import type { DockviewApi } from "dockview-react";
import type { ManagedPanelDef } from "@/lib/workspace-panels";

/**
 * Bridges a workspace page's dockview api (Home/Portfolio/Optimal, each
 * mounted/unmounted per route) to the Sidebar, a sibling in the layout tree
 * that can't reach it via props. Whichever workspace is currently mounted
 * registers its api + panel list here; the Sidebar reads it to render the
 * "restore a closed panel" accordion under the matching nav item.
 *
 * `tick` exists purely to force a re-render: api.getPanel(id) is read fresh
 * every render rather than mirrored into this store, so it can never drift
 * from what's actually on screen (a panel closed via its own X button is
 * reflected immediately). Each workspace bumps it from its own
 * onDidLayoutChange handler.
 */
interface WorkspacePanelsState {
  workspaceId: string | null;
  api: DockviewApi | null;
  panels: ManagedPanelDef[];
  onReset: (() => void) | null;
  tick: number;
  register: (workspaceId: string, api: DockviewApi, panels: ManagedPanelDef[], onReset: () => void) => void;
  unregister: (workspaceId: string) => void;
  bumpTick: () => void;
}

export const useWorkspacePanelsStore = create<WorkspacePanelsState>((set, get) => ({
  workspaceId: null,
  api: null,
  panels: [],
  onReset: null,
  tick: 0,
  register: (workspaceId, api, panels, onReset) => set({ workspaceId, api, panels, onReset }),
  unregister: (workspaceId) => {
    if (get().workspaceId === workspaceId) set({ workspaceId: null, api: null, panels: [], onReset: null });
  },
  bumpTick: () => set((state) => ({ tick: state.tick + 1 })),
}));
