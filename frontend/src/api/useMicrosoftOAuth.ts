import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api } from "./client";

interface StartResponse {
  flow_id: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
}

interface PollResponse {
  status: "pending" | "complete" | "error";
  error: string | null;
  account_id: number | null;
}

export function useMicrosoftOAuthFlow(reconnectAccountId?: number) {
  const [flowId, setFlowId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const start = useMutation({
    mutationFn: (payload: {
      name?: string;
      color?: string;
      client_id?: string;
      tenant?: string;
    }) =>
      reconnectAccountId
        ? api.post<StartResponse>(`/api/accounts/oauth/microsoft/reconnect/${reconnectAccountId}`)
        : api.post<StartResponse>("/api/accounts/oauth/microsoft/start", payload),
    onSuccess: (data) => setFlowId(data.flow_id),
  });

  const poll = useQuery({
    queryKey: ["oauth-microsoft-poll", flowId],
    queryFn: () => api.get<PollResponse>(`/api/accounts/oauth/microsoft/poll/${flowId}`),
    enabled: flowId !== null,
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3000 : false),
  });

  useEffect(() => {
    if (poll.data?.status === "complete") {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    }
  }, [poll.data?.status, queryClient]);

  return { start, poll, flowId, reset: () => setFlowId(null) };
}
