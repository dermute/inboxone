import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface Settings {
  sync_interval_seconds: number;
}

export default function RefreshSettings() {
  const cache = useQueryClient();
  const [minutes, setMinutes] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.get<Settings>("/api/settings"),
  });
  const save = useMutation({
    mutationFn: (value: number) => api.patch<Settings>("/api/settings", {
      sync_interval_seconds: value * 60,
    }),
    onSuccess: (data) => {
      cache.setQueryData(["settings"], data);
      setMinutes(null);
      void cache.invalidateQueries({ queryKey: ["connections"] });
    },
  });
  const value = minutes ?? (query.data ? String(query.data.sync_interval_seconds / 60) : "");
  const valid = value !== "" && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1440;

  return (
    <form className="glass-card mb-6 space-y-3 p-4" onSubmit={(event) => {
      event.preventDefault();
      if (valid) save.mutate(Number(value));
    }}>
      <h2 className="font-medium">Automatic refresh</h2>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        Check all accounts on this schedule. Incoming mail still updates immediately when supported.
      </p>
      {query.isError ? <p role="alert">Could not load refresh settings. <button type="button" className="underline" onClick={() => query.refetch()}>Retry</button></p> : (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            Refresh every
            <input type="number" min="1" max="1440" step="1" required
              aria-label="Automatic refresh interval in minutes"
              className="input max-w-24" value={value}
              disabled={!query.data || save.isPending}
              onChange={(event) => { setMinutes(event.target.value); save.reset(); }} />
            minutes
          </label>
          <button type="submit" className="glass-button" disabled={!query.data || !valid || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
      {save.isSuccess && <p role="status" className="text-sm">Refresh interval saved.</p>}
      {save.isError && <p role="alert" className="text-sm text-red-600">Could not save refresh interval. Please try again.</p>}
    </form>
  );
}
