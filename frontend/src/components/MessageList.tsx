import { useEffect, useRef } from "react";

import type { MessageSummary } from "../api/types";
import MessageListItem from "./MessageListItem";

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
}: {
  messages: MessageSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  onMarkRead: (id: number) => void;
  onMarkAllRead: () => void;
  markAllPending: boolean;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex h-full flex-col">
      <div className="glass-divider flex shrink-0 items-center justify-end border-b px-4 py-2">
        <button
          onClick={onMarkAllRead}
          disabled={!hasUnread || markAllPending}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:cursor-default disabled:text-gray-400 dark:text-indigo-400 dark:hover:text-indigo-300 dark:disabled:text-gray-600"
        >
          Mark all as read
        </button>
      </div>
      {!isLoading && messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No messages yet - accounts sync automatically in the background.
        </div>
      ) : (
        <div className="flex-1 divide-y divide-black/[0.06] overflow-y-auto dark:divide-white/10">
          {messages.map((m) => (
            <MessageListItem
              key={m.id}
              message={m}
              selected={m.id === selectedId}
              onClick={() => onSelect(m.id)}
              onMarkRead={() => onMarkRead(m.id)}
            />
          ))}
          <div ref={sentinelRef} className="h-4" />
        </div>
      )}
    </div>
  );
}
