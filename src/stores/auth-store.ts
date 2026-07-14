import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AuthState {
  isAuthenticated: boolean;
  hasHydrated: boolean;
  login: () => void;
  logout: () => void;
  setHasHydrated: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      isAuthenticated: false,
      hasHydrated: false,
      login: () => set({ isAuthenticated: true }),
      logout: () => set({ isAuthenticated: false }),
      setHasHydrated: (value) => set({ hasHydrated: value }),
    }),
    {
      name: "auth-storage",
      // Persisted state loads asynchronously on the client -- a fresh page
      // load (direct nav to /upload, a refresh, a new tab) sees the default
      // isAuthenticated=false for one tick before localStorage is read, so
      // any redirect guard that checks isAuthenticated without waiting for
      // hasHydrated bounces an already-logged-in user back to "/" every
      // time (same hydration race upload-store.ts's isProcessed flag
      // already guards against).
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
