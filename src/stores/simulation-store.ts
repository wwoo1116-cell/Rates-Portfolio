import { create } from "zustand";
import type { AssetClass, Tenor } from "@/lib/constants";
import type { Direction } from "@/types/portfolio";

export interface SandboxTrade {
  id: string;
  assetClass: AssetClass;
  direction: Direction;
  notionalKrwEok: number;
  tenor: Tenor;
  rate: number;
}

interface SimulationState {
  sandboxTrades: SandboxTrade[];
  addTrade: (trade: Omit<SandboxTrade, "id">) => void;
  removeTrade: (id: string) => void;
  clearTrades: () => void;
}

export const useSimulationStore = create<SimulationState>((set) => ({
  sandboxTrades: [],
  addTrade: (trade) =>
    set((state) => ({
      sandboxTrades: [
        ...state.sandboxTrades,
        { ...trade, id: `SND-${Math.random().toString(36).substr(2, 9).toUpperCase()}` },
      ],
    })),
  removeTrade: (id) =>
    set((state) => ({
      sandboxTrades: state.sandboxTrades.filter((t) => t.id !== id),
    })),
  clearTrades: () => set({ sandboxTrades: [] }),
}));
