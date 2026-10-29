import { create } from "zustand";

export interface WorkItem {
  id: string;
  label: string;
  kind: string;
  state?: "queued" | "running";
  account_id?: number | null;
  folder_id?: number | null;
  folder_ids?: number[] | null;
  message_id?: number | null;
  priority?: number;
}
export type WorkDescription = Omit<WorkItem, "id">;

export const useActivityStore = create<{
  local: WorkItem[];
  server: WorkItem[];
  revision: number;
}>(() => ({ local: [], server: [], revision: 0 }));
let sequence = 0;
let snapshotRequest = 0;
let appliedSnapshot = 0;

export function beginWork(work: WorkDescription): () => void {
  const id = `local-${++sequence}`;
  useActivityStore.setState((state) => ({ local: [...state.local, { ...work, id }] }));
  return () => useActivityStore.setState((state) => ({ local: state.local.filter((item) => item.id !== id) }));
}

export function receiveActivity(items: WorkItem[]) {
  useActivityStore.setState((state) => ({ server: items, revision: state.revision + 1 }));
}

// A slow HTTP snapshot must never overwrite a newer event received on the stream.
export async function refreshActivity() {
  const revision = useActivityStore.getState().revision;
  const request = ++snapshotRequest;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("/api/sync/activity", { credentials: "include", signal: controller.signal });
    if (!response.ok) return;
    const data = await response.json();
    if (useActivityStore.getState().revision === revision && request >= appliedSnapshot) {
      appliedSnapshot = request;
      useActivityStore.setState({ server: data.items });
    }
  } catch {
    // Connection health already reports the unavailable event stream/server.
  } finally {
    window.clearTimeout(timeout);
  }
}

function sameWork(local: WorkItem, server: WorkItem) {
  if (local.kind !== server.kind) return false;
  if (local.message_id != null) return local.message_id === server.message_id;
  if (local.account_id != null && local.account_id !== server.account_id) return false;
  if (local.folder_id != null) {
    return server.folder_id === local.folder_id ||
      (server.folder_ids == null && server.folder_id == null) ||
      server.folder_ids?.includes(local.folder_id);
  }
  return true;
}

export function visibleWork(local: WorkItem[], server: WorkItem[]): WorkItem[] {
  // Recent actions in this tab lead; backend phases for those actions are hidden.
  return [...local].reverse().sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100)).concat(server.filter((item) => !local.some((own) => sameWork(own, item))));
}
