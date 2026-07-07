import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import type { MessageDetail, MessageListPage } from "./types";

interface MessageFilters {
  accountId?: number | null;
  folderId?: number | null;
  unreadOnly?: boolean;
}

function buildQuery(filters: MessageFilters, cursor?: string | null) {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("account_id", String(filters.accountId));
  if (filters.folderId) params.set("folder_id", String(filters.folderId));
  if (filters.unreadOnly) params.set("unread_only", "true");
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function useMessages(filters: MessageFilters) {
  return useInfiniteQuery({
    queryKey: ["messages", filters],
    queryFn: ({ pageParam }) =>
      api.get<MessageListPage>(`/api/messages?${buildQuery(filters, pageParam)}`),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    refetchInterval: 15_000,
  });
}

export function useMessage(id: number | null) {
  return useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: () => api.get<MessageDetail>(`/api/messages/${id}`),
    enabled: id !== null,
    staleTime: 0,
  });
}

export function useUpdateFlags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, seen, flagged }: { id: number; seen?: boolean; flagged?: boolean }) =>
      api.post(`/api/messages/${id}/flags`, { seen, flagged }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });
}

export function useReply() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
    }: {
      id: number;
      accountId?: number;
      to: string[];
      cc?: string[];
      bcc?: string[];
      subject: string;
      bodyHtml: string;
    }) =>
      api.post(`/api/messages/${id}/reply`, {
        account_id: accountId,
        to,
        cc: cc ?? [],
        bcc: bcc ?? [],
        subject,
        body_html: bodyHtml,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });
}
