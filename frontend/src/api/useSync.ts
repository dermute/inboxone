import { useMutation } from "@tanstack/react-query";

import { api } from "./client";

interface TriggerSyncResponse {
  triggered: number[];
}

// Completion is delivered through the authenticated event stream.
export function useTriggerSync() {
  return useMutation({
    mutationFn: (accountId?: number) =>
      api.post<TriggerSyncResponse>(
        `/api/sync/trigger${accountId !== undefined ? `?account_id=${accountId}` : ""}`
      ),
  });
}
