import { create } from "zustand";

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  duration: number;
}

interface ToastState {
  toasts: Toast[];
  show: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: ({ duration = 5000, ...rest }) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, duration, ...rest }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Convenience wrapper so event handlers don't need the hook.
export function toast(
  message: string,
  opts?: { actionLabel?: string; onAction?: () => void; duration?: number }
): number {
  return useToastStore.getState().show({ message, ...opts });
}
