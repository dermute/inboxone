import { useMutation } from "@tanstack/react-query";

import { api } from "./client";

interface TriggerSyncResponse {
  triggered: number[];
}

// Queues a sync of every active account (or one account, if an id is given).
// The request returns as soon as the syncs are queued server-side - progress
// then shows up in the activity feed the status bar already polls, so there is
// nothing to invalidate here.
export function useTriggerSync() {
  return useMutation({
    mutationFn: (accountId?: number) =>
      api.post<TriggerSyncResponse>(
        `/api/sync/trigger${accountId !== undefined ? `?account_id=${accountId}` : ""}`
      ),
  });
}
