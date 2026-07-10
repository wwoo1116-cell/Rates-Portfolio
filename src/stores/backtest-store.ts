import { create } from "zustand";
import { ALL_SCENARIOS, computeBacktestResult, type BacktestResult, type TenorShock } from "@/mocks/backtest";

interface BacktestState {
  selectedScenarioId: string | null;
  isRunning: boolean;
  result: BacktestResult | null;
  selectScenario: (id: string) => void;
  runBacktest: (buckets: TenorShock, totalDv01: number) => void;
}

export const useBacktestStore = create<BacktestState>((set, get) => ({
  selectedScenarioId: null,
  isRunning: false,
  result: null,
  selectScenario: (id) => set({ selectedScenarioId: id }),
  runBacktest: (buckets, totalDv01) => {
    const { selectedScenarioId, isRunning } = get();
    if (!selectedScenarioId || isRunning) return;

    const scenario = ALL_SCENARIOS.find((s) => s.id === selectedScenarioId);
    if (!scenario) return;

    set({ isRunning: true });
    const delay = 100 + Math.random() * 200;
    setTimeout(() => {
      set({ result: computeBacktestResult(scenario, buckets, totalDv01), isRunning: false });
    }, delay);
  },
}));
