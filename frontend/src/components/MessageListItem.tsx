import type { MessageSummary } from "../api/types";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function MessageListItem({
  message,
  selected,
  onClick,
  onMarkRead,
  onDelete,
}: {
  message: MessageSummary;
  selected: boolean;
  onClick: () => void;
  onMarkRead: (seen: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onClick();
      }}
      className={`group flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors ${
        selected ? "bg-indigo-500/10 dark:bg-indigo-400/15" : "glass-hover"
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMarkRead(!message.is_seen);
        }}
        title={message.is_seen ? "Mark as unread" : "Mark as read"}
        className="mt-1 shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-indigo-600 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-gray-500 dark:hover:text-indigo-400"
      >
        ✉️
      </button>
      <span
        className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: message.account_color }}
        title={message.account_name}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className={`truncate text-sm ${message.is_seen ? "font-normal text-gray-700 dark:text-gray-300" : "font-semibold text-gray-900 dark:text-white"}`}
          >
            {message.from_name || message.from_addr || "(unknown sender)"}
          </span>
          <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
            {formatDate(message.date_sent)}
          </span>
        </div>
        <div
          className={`truncate text-sm ${message.is_seen ? "text-gray-600 dark:text-gray-400" : "font-medium text-gray-900 dark:text-white"}`}
        >
          {message.subject || "(no subject)"}
        </div>
        <div className="truncate text-xs text-gray-500 dark:text-gray-400">{message.snippet}</div>
      </div>
      {message.has_attachments && (
        <span className="mt-1 shrink-0 text-gray-500 dark:text-gray-400" title="Has attachments">
          📎
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Delete"
        className="mt-1 shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-gray-500 dark:hover:text-red-400"
      >
        🗑️
      </button>
    </div>
  );
}
