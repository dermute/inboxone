import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAccounts } from "../api/useAccounts";
import { useActivity } from "../api/useActivity";
import { useTriggerSync } from "../api/useSync";
import { toast } from "../store/toastStore";
import { RefreshIcon } from "./icons";

function relativeTime(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export default function StatusBar() {
  const queryClient = useQueryClient();
  const { data: accounts } = useAccounts();
  const { data: activityData } = useActivity();
  const { mutate: triggerSync, isPending } = useTriggerSync();

  const items = activityData?.items ?? [];
  const isActive = items.length > 0;
  const busy = isActive || isPending;

  const lastSyncedLabel = useMemo(() => {
    const times = (accounts ?? [])
      .map((a) => a.last_sync_at)
      .filter((t): t is string => !!t)
      .sort()
      .reverse();
    return times.length > 0 ? relativeTime(times[0]) : null;
  }, [accounts]);

  // Pull in whatever the sync found the moment the last job goes quiet - otherwise
  // a forced sync's new mail only surfaces on the message list's own 15s poll.
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !isActive) {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    }
    wasActive.current = isActive;
  }, [isActive, queryClient]);

  function handleForceSync() {
    if (busy) return;
    triggerSync(undefined, {
      onSuccess: (data) => {
        if (data.triggered.length === 0) toast("No active accounts to sync");
      },
      onError: (err) => toast(`Could not start sync: ${err.message}`),
    });
  }

  return (
    <div className="flex shrink-0 justify-center px-3 pb-3 pt-1">
      <div className="glass-card flex max-w-md items-center gap-2 py-1.5 pl-4 pr-1.5 text-xs text-gray-600 shadow-lg dark:text-gray-300">
        <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              isActive ? "animate-pulse bg-indigo-500" : "bg-green-500"
            }`}
          />
          {isActive ? (
            <span className="truncate">
              {items[0].label}
              {items.length > 1 ? ` (+${items.length - 1} more)` : ""}
            </span>
          ) : (
            <span className="truncate">
              Up to date{lastSyncedLabel ? ` · synced ${lastSyncedLabel}` : ""}
            </span>
          )}
        </div>
        <button
          onClick={handleForceSync}
          disabled={busy}
          title={busy ? "Sync already running" : "Force sync now"}
          aria-label="Force sync now"
          className="glass-hover flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent dark:disabled:hover:bg-transparent"
        >
          <RefreshIcon className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Sync now</span>
        </button>
      </div>
    </div>
  );
}
