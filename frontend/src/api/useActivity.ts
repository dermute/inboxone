import { useQuery } from "@tanstack/react-query";

import { api } from "./client";

interface ActivityItem {
  label: string;
  seconds: number;
}

interface ActivityResponse {
  items: ActivityItem[];
}

export function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: () => api.get<ActivityResponse>("/api/sync/activity"),
    refetchInterval: 2000,
  });
}
