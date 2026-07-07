import { create } from "zustand";

interface ComposeState {
  open: boolean;
  replyToMessageId: number | null;
  defaultAccountId: number | null;
  defaultTo: string[];
  defaultSubject: string;
  quotedHtml: string;
}

interface UiState {
  selectedAccountId: number | null;
  selectedMessageId: number | null;
  compose: ComposeState;
  setSelectedAccountId: (id: number | null) => void;
  setSelectedMessageId: (id: number | null) => void;
  openReply: (params: {
    replyToMessageId: number;
    defaultAccountId: number;
    defaultTo: string[];
    defaultSubject: string;
    quotedHtml: string;
  }) => void;
  closeCompose: () => void;
}

const initialCompose: ComposeState = {
  open: false,
  replyToMessageId: null,
  defaultAccountId: null,
  defaultTo: [],
  defaultSubject: "",
  quotedHtml: "",
};

export const useUiStore = create<UiState>((set) => ({
  selectedAccountId: null,
  selectedMessageId: null,
  compose: initialCompose,
  setSelectedAccountId: (id) => set({ selectedAccountId: id }),
  setSelectedMessageId: (id) => set({ selectedMessageId: id }),
  openReply: (params) =>
    set({
      compose: { open: true, ...params },
    }),
  closeCompose: () => set({ compose: initialCompose }),
}));
