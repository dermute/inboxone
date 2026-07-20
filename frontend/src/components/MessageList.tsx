import { useEffect, useRef } from "react";

import type { MessageSummary } from "../api/types";
import { MenuIcon } from "./icons";
import MessageListItem from "./MessageListItem";
import Skeleton from "./Skeleton";

export default function MessageList({
  messages,
  selectedId,
  onSelect,
  onLoadMore,
  hasMore,
  isLoading,
  onMarkRead,
  onMarkAllRead,
  markAllPending,
  onDelete,
  onOpenRail,
}: {
  messages: MessageSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  onMarkRead: (id: number, seen: boolean) => void;
  onMarkAllRead: () => void;
  markAllPending: boolean;
  onDelete: (id: number) => void;
  onOpenRail: () => void;
}) {
  const sentinelRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore) onLoadMore();
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  const hasUnread = messages.some((m) => !m.is_seen);
  // Roving tabindex: the selected row (or the first row) is the single tab stop.
  const tabbableId = messages.some((m) => m.id === selectedId) ? selectedId : messages[0]?.id;

  function handleListKeyDown(e: React.KeyboardEvent<HTMLUListElement>) {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;

    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-msg-row]"));
      if (rows.length === 0) return;
      const currentIndex = rows.findIndex((r) => r.closest("li") === active.closest("li"));
      let next: number;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = rows.length - 1;
      else if (currentIndex === -1) next = 0;
      else if (e.key === "ArrowDown") next = Math.min(currentIndex + 1, rows.length - 1);
      else next = Math.max(currentIndex - 1, 0);
      e.preventDefault();
      rows[next].focus();
      rows[next].scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      // Move between the controls of the focused row (mark-read, open, delete).
      const row = active.closest("li");
      if (!row) return;
      const controls = Array.from(row.querySelectorAll<HTMLElement>("button"));
      const currentIndex = controls.indexOf(active);
      if (currentIndex === -1) return;
      const next =
        e.key === "ArrowRight"
          ? Math.min(currentIndex + 1, controls.length - 1)
          : Math.max(currentIndex - 1, 0);
      e.preventDefault();
      controls[next].focus();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="glass-divider flex shrink-0 items-center border-b px-4 py-2">
        <button
          onClick={onOpenRail}
          aria-label="Open accounts and folders"
          className="-ml-1 rounded p-1 text-gray-600 dark:text-gray-300 lg:hidden"
        >
          <MenuIcon />
        </button>
        <button
          onClick={onMarkAllRead}
          disabled={!hasUnread || markAllPending}
          className="ml-auto text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:cursor-default disabled:text-gray-400 dark:text-indigo-400 dark:hover:text-indigo-300 dark:disabled:text-gray-600"
        >
          Mark all as read
        </button>
      </div>
      {isLoading ? (
        <div
          aria-label="Loading messages"
          role="status"
          className="flex-1 divide-y divide-black/[0.06] overflow-hidden dark:divide-white/10"
        >
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="space-y-2 px-4 py-3">
              <div className="flex justify-between gap-2">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-10" />
              </div>
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-5/6" />
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-gray-600 dark:text-gray-300">
          No messages yet - accounts sync automatically in the background.
        </div>
      ) : (
        <ul
          role="list"
          aria-label="Messages"
          onKeyDown={handleListKeyDown}
          className="flex-1 divide-y divide-black/[0.06] overflow-y-auto dark:divide-white/10"
        >
          {messages.map((m) => (
            <MessageListItem
              key={m.id}
              message={m}
              selected={m.id === selectedId}
              tabbable={m.id === tabbableId}
              onClick={() => onSelect(m.id)}
              onMarkRead={(seen) => onMarkRead(m.id, seen)}
              onDelete={() => onDelete(m.id)}
            />
          ))}
          <li ref={sentinelRef} aria-hidden="true" className="h-4" />
        </ul>
      )}
    </div>
  );
}
