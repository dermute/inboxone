import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import type { Account, AccountCreateBasic, Folder, TestConnectionResult } from "./types";

export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<Account[]>("/api/accounts"),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AccountCreateBasic) => api.post<Account>("/api/accounts", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Partial<AccountCreateBasic> & { is_active?: boolean } }) =>
      api.put<Account>(`/api/accounts/${id}`, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete(`/api/accounts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["accounts"] }),
  });
}

export function useTestConnection() {
  return useMutation({
    mutationFn: (id: number) => api.post<TestConnectionResult>(`/api/accounts/${id}/test-connection`),
  });
}

export function useAccountFolders(accountId: number | null) {
  return useQuery({
    queryKey: ["accounts", accountId, "folders"],
    queryFn: () => api.get<Folder[]>(`/api/accounts/${accountId}/folders`),
    enabled: accountId !== null,
  });
}

export function useUpdateAccountFolders(accountId: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (folders: { imap_path: string; sync_enabled: boolean }[]) =>
      api.put<Folder[]>(`/api/accounts/${accountId}/folders`, { folders }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["accounts", accountId, "folders"] });
    },
  });
}
