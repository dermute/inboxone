import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import type { MessageDetail, MessageListPage } from "./types";

interface SendResult {
  sent: boolean;
  warning: string | null;
}

interface MessageFilters {
  accountId?: number | null;
  folderId?: number | null;
  unreadOnly?: boolean;
  search?: string;
}

function buildQuery(filters: MessageFilters, cursor?: string | null) {
  const params = new URLSearchParams();
  if (filters.accountId) params.set("account_id", String(filters.accountId));
  if (filters.folderId) params.set("folder_id", String(filters.folderId));
  if (filters.unreadOnly) params.set("unread_only", "true");
  if (filters.search) params.set("search", filters.search);
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

// Poll inbox folders across accounts, excluding historical backfills. A membership
// change uses a fresh query so notification tracking can establish a new baseline.
export function useRecentUnread(membership: string) {
  return useQuery({
    queryKey: ["messages", "recent-unread", membership],
    queryFn: () => api.get<MessageListPage>("/api/messages?unread_only=true&notifications_only=true&limit=200"),
    refetchInterval: 20_000,
    // Without this, React Query pauses the interval entirely while the tab is
    // backgrounded - the new-mail notifier would never see anything to diff against.
    refetchIntervalInBackground: true,
  });
}

export function useMessage(id: number | null) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["messages", "detail", id],
    queryFn: async () => {
      const detail = await api.get<MessageDetail>(`/api/messages/${id}`);
      // Opening a message marks it read server-side (if it wasn't already), which
      // changes per-account/folder unread counts - the sidebar badges otherwise have
      // no way to know that happened until their own next independent poll.
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["messages"], exact: false, predicate: (query) =>
        query.queryKey[1] !== "detail"
      });
      return detail;
    },
    enabled: id !== null,
    staleTime: 0,
  });
}

export function useUpdateFlags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, seen, flagged }: { id: number; seen?: boolean; flagged?: boolean }) =>
      api.post(`/api/messages/${id}/flags`, { seen, flagged }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, folderId }: { accountId?: number | null; folderId?: number | null }) => {
      const params = new URLSearchParams();
      if (accountId) params.set("account_id", String(accountId));
      if (folderId) params.set("folder_id", String(folderId));
      const qs = params.toString();
      return api.post(`/api/messages/mark-all-read${qs ? `?${qs}` : ""}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/messages/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
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
      api.post<SendResult>(`/api/messages/${id}/reply`, {
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

export function useForward() {
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
      api.post<SendResult>(`/api/messages/${id}/forward`, {
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
