import { useMemo } from "react";

import { useAccounts } from "../api/useAccounts";
import { useActivity } from "../api/useActivity";

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
  const { data: accounts } = useAccounts();
  const { data: activityData } = useActivity();

  const items = activityData?.items ?? [];
  const isActive = items.length > 0;

  const lastSyncedLabel = useMemo(() => {
    const times = (accounts ?? [])
      .map((a) => a.last_sync_at)
      .filter((t): t is string => !!t)
      .sort()
      .reverse();
    return times.length > 0 ? relativeTime(times[0]) : null;
  }, [accounts]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 flex justify-center">
      <div className="glass-card pointer-events-auto flex max-w-md items-center gap-2 px-4 py-1.5 text-xs text-gray-600 shadow-lg dark:text-gray-300">
        <span
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
    </div>
  );
}
