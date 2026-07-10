// Theme store stub — dark-only, no toggle.
// Kept as a compatibility shim so remaining imports don't break.
import { create } from "zustand";

export type Theme = "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(() => ({
  theme: "dark" as const,
  setTheme: () => {},      // no-op: dark-only
  toggleTheme: () => {},   // no-op: dark-only
}));
