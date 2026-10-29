import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "./client";
import type { Connections } from "./liveSync";

export function useConnections() {
  return useQuery({ queryKey: ["connections"],
    queryFn: () => api.get<Connections>("/api/sync/connections") });
}

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
