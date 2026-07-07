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
}: {
  messages: MessageSummary[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
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

  if (!isLoading && messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        No messages yet - accounts sync automatically in the background.
      </div>
    );
  }

  return (
    <div className="h-full divide-y divide-gray-100 overflow-y-auto dark:divide-neutral-800">
      {messages.map((m) => (
        <MessageListItem
          key={m.id}
          message={m}
          selected={m.id === selectedId}
          onClick={() => onSelect(m.id)}
        />
      ))}
      <div ref={sentinelRef} className="h-4" />
    </div>
  );
}
