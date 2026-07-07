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
}: {
  message: MessageSummary;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{ borderLeftColor: message.account_color }}
      className={`flex w-full items-start gap-3 border-l-4 px-4 py-3 text-left transition-colors ${
        selected ? "bg-indigo-50 dark:bg-neutral-700" : "hover:bg-gray-50 dark:hover:bg-neutral-800"
      }`}
    >
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
          <span className="shrink-0 text-xs text-gray-400">{formatDate(message.date_sent)}</span>
        </div>
        <div
          className={`truncate text-sm ${message.is_seen ? "text-gray-500" : "font-medium text-gray-900 dark:text-white"}`}
        >
          {message.subject || "(no subject)"}
        </div>
        <div className="truncate text-xs text-gray-400">{message.snippet}</div>
      </div>
      {message.has_attachments && (
        <span className="mt-1 shrink-0 text-gray-400" title="Has attachments">
          📎
        </span>
      )}
    </button>
  );
}
