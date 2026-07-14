import { create } from "zustand";
import { persist } from "zustand/middleware";

export type FileSlotKey = "irsData" | "creditMatrix" | "bokBaseRate" | "portfolioData";
export type FileSlotStatus = "empty" | "selected" | "uploading" | "ready" | "error";

export interface FileSlotState {
  status: FileSlotStatus;
  fileName?: string;
  errorMessage?: string;
  rows?: number;
  minDate?: string;
  maxDate?: string;
}

interface UploadState {
  irsData: FileSlotState;
  creditMatrix: FileSlotState;
  bokBaseRate: FileSlotState;
  portfolioData: FileSlotState;
  isProcessed: boolean;
  hasHydrated: boolean;
  setSlot: (key: FileSlotKey, patch: Partial<FileSlotState>) => void;
  resetSlots: () => void;
  setProcessed: (value: boolean) => void;
  setHasHydrated: (value: boolean) => void;
}

const emptySlot: FileSlotState = { status: "empty" };

export const useUploadStore = create<UploadState>()(
  persist(
    (set) => ({
      irsData: { ...emptySlot },
      creditMatrix: { ...emptySlot },
      bokBaseRate: { ...emptySlot },
      portfolioData: { ...emptySlot },
      isProcessed: false,
      hasHydrated: false,
      setSlot: (key, patch) => set((state) => ({ [key]: { ...state[key], ...patch } }) as Partial<UploadState>),
      resetSlots: () =>
        set({
          irsData: { ...emptySlot },
          creditMatrix: { ...emptySlot },
          bokBaseRate: { ...emptySlot },
          portfolioData: { ...emptySlot },
        }),
      setProcessed: (value) => set({ isProcessed: value }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "upload-storage",
      // Only the gate flag needs to survive a reload -- per-slot file
      // status (filenames, row counts) is re-derived each time the upload
      // page is visited, and a stale "ready"/"error" badge with no backing
      // File object would be misleading.
      partialize: (state) => ({ isProcessed: state.isProcessed }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
