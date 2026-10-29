import { create } from "zustand";

export const useLiveSync = create<{ connected: boolean }>(() => ({ connected: false }));

export interface FolderConnection {
  folder_id: number;
  name: string;
  is_inbox: boolean;
  state: string;
  mode: string;
  health: string;
  last_success?: string;
  error?: string;
  error_at?: string;
  sync_error?: string;
  sync_error_at?: string;
  next_retry?: string;
}
export interface Connections {
  health: string;
  refresh_seconds: number;
  accounts: { account_id: number; name: string; color: string; health: string;
    error?: string; error_at?: string; folders: FolderConnection[] }[];
}
