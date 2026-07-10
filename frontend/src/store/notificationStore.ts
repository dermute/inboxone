import { create } from "zustand";

const STORAGE_KEY = "notifications-enabled";

function getStoredEnabled(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

interface NotificationState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  enabled: getStoredEnabled(),
  setEnabled: (enabled) => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
    set({ enabled });
  },
}));
