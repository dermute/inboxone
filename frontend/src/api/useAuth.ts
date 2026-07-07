import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";

interface AuthStatus {
  authenticated: boolean;
}

export function useAuth() {
  const queryClient = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<AuthStatus>("/api/auth/me"),
    retry: false,
  });

  const login = useMutation({
    mutationFn: (password: string) => api.post<AuthStatus>("/api/auth/login", { password }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  const logout = useMutation({
    mutationFn: () => api.post<AuthStatus>("/api/auth/logout"),
    onSuccess: () => {
      queryClient.clear();
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  return {
    isAuthenticated: meQuery.data?.authenticated ?? false,
    isLoading: meQuery.isLoading,
    login,
    logout,
  };
}
