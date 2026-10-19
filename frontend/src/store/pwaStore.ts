import { create } from "zustand";

// Chromium exposes this event without including it in the standard DOM types.
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface PwaState {
  installPrompt: InstallPromptEvent | null;
  installed: boolean;
  install: () => Promise<void>;
}

const standalone = window.matchMedia("(display-mode: standalone)");

export const usePwaStore = create<PwaState>((set, get) => ({
  installPrompt: null,
  installed: standalone.matches,
  install: async () => {
    const { installPrompt, installed } = get();
    if (!installPrompt || installed) return;

    // A prompt can only be used once. Clearing it also prevents double clicks.
    set({ installPrompt: null });
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") set({ installed: true });
  },
}));

// Capture the event at startup, even before login or the sidebar has mounted.
window.addEventListener("beforeinstallprompt", (event) => {
  if (!window.isSecureContext || usePwaStore.getState().installed) return;
  event.preventDefault();
  usePwaStore.setState({ installPrompt: event as InstallPromptEvent });
});

window.addEventListener("appinstalled", () => {
  usePwaStore.setState({ installed: true, installPrompt: null });
});

standalone.addEventListener("change", (event) => {
  if (event.matches) {
    usePwaStore.setState({ installed: true, installPrompt: null });
  }
});
