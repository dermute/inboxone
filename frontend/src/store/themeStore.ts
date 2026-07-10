import { create } from "zustand";

export type ThemePreference = "light" | "dark" | "auto";

const STORAGE_KEY = "theme";

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(preference: ThemePreference): void {
  const isDark = preference === "dark" || (preference === "auto" && systemPrefersDark());
  document.documentElement.classList.toggle("dark", isDark);
}

function getStoredPreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: getStoredPreference(),
  setPreference: (preference) => {
    localStorage.setItem(STORAGE_KEY, preference);
    applyTheme(preference);
    set({ preference });
  },
}));

// Live-follow the OS theme while "auto" is selected, without needing a reload.
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (useThemeStore.getState().preference === "auto") {
    applyTheme("auto");
  }
});
