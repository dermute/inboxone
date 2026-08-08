import { create } from "zustand";

interface ComposeState {
  open: boolean;
  mode: "reply" | "forward";
  sourceMessageId: number | null;
  defaultAccountId: number | null;
  defaultTo: string[];
  defaultSubject: string;
  quotedHtml: string;
}

interface UiState {
  selectedAccountId: number | null;
  selectedFolderId: number | null;
  selectedMessageId: number | null;
  compose: ComposeState;
  setSelectedAccountId: (id: number | null) => void;
  setSelectedFolderId: (id: number | null) => void;
  setSelectedMessageId: (id: number | null) => void;
  openReply: (params: {
    sourceMessageId: number;
    defaultAccountId: number;
    defaultTo: string[];
    defaultSubject: string;
    quotedHtml: string;
  }) => void;
  openForward: (params: {
    sourceMessageId: number;
    defaultAccountId: number;
    defaultTo: string[];
    defaultSubject: string;
    quotedHtml: string;
  }) => void;
  closeCompose: () => void;
}

const initialCompose: ComposeState = {
  open: false,
  mode: "reply",
  sourceMessageId: null,
  defaultAccountId: null,
  defaultTo: [],
  defaultSubject: "",
  quotedHtml: "",
};

export const useUiStore = create<UiState>((set) => ({
  selectedAccountId: null,
  selectedFolderId: null,
  selectedMessageId: null,
  compose: initialCompose,
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  setSelectedFolderId: (id) => set({ selectedFolderId: id }),
  setSelectedMessageId: (id) => set({ selectedMessageId: id }),
  openReply: (params) =>
    set({
      compose: { open: true, mode: "reply", ...params },
    }),
  openForward: (params) =>
    set({
      compose: { open: true, mode: "forward", ...params },
    }),
  closeCompose: () => set({ compose: initialCompose }),
}));
