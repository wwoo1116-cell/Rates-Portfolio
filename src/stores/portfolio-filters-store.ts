import { create } from "zustand";
import type { GroupByOption } from "@/types/portfolio";

export type FilterKey = "book" | "assetClass" | "tenor" | "direction";

export interface ActiveFilter {
  key: FilterKey;
  label: string;
  values: string[];
}

interface PortfolioFiltersState {
  filters: ActiveFilter[];
  groupBy: GroupByOption;
  rowHeight: "dense" | "comfortable";
  selectedPositionId: string | null;
  addFilter: (filter: ActiveFilter) => void;
  removeFilter: (key: FilterKey) => void;
  setGroupBy: (groupBy: GroupByOption) => void;
  setRowHeight: (rowHeight: "dense" | "comfortable") => void;
  setSelectedPositionId: (id: string | null) => void;
}

export const usePortfolioFiltersStore = create<PortfolioFiltersState>((set) => ({
  filters: [],
  groupBy: "none",
  rowHeight: "dense",
  selectedPositionId: null,
  addFilter: (filter) =>
    set((state) => ({
      filters: [...state.filters.filter((f) => f.key !== filter.key), filter],
    })),
  removeFilter: (key) =>
    set((state) => ({ filters: state.filters.filter((f) => f.key !== key) })),
  setGroupBy: (groupBy) => set({ groupBy }),
  setRowHeight: (rowHeight) => set({ rowHeight }),
  setSelectedPositionId: (id) => set({ selectedPositionId: id }),
}));
