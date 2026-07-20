import type { MessageSummary } from "../api/types";
import { MailIcon, MailOpenIcon, PaperclipIcon, TrashIcon } from "./icons";

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
  tabbable,
  onClick,
  onMarkRead,
  onDelete,
}: {
  message: MessageSummary;
  selected: boolean;
  /* Roving tabindex: exactly one row button in the list is in the tab order;
     the rest are reached with arrow keys (handled by MessageList). */
  tabbable: boolean;
  onClick: () => void;
  onMarkRead: (seen: boolean) => void;
  onDelete: () => void;
}) {
  return (
    <li
      className={`group flex items-start gap-3 px-4 py-3 transition-colors ${
        selected ? "bg-indigo-500/10 dark:bg-indigo-400/15" : "glass-hover"
      }`}
    >
      <button
        onClick={() => onMarkRead(!message.is_seen)}
        tabIndex={-1}
        title={message.is_seen ? "Mark as unread" : "Mark as read"}
        aria-label={message.is_seen ? "Mark as unread" : "Mark as read"}
        className="mt-1 shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-indigo-600 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 dark:text-gray-500 dark:hover:text-indigo-400"
      >
        {message.is_seen ? <MailIcon /> : <MailOpenIcon />}
      </button>
      <button
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === "Delete") {
            e.preventDefault();
            onDelete();
          }
        }}
        data-msg-row
        tabIndex={tabbable ? 0 : -1}
        aria-current={selected ? "true" : undefined}
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-left"
      >
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: message.account_color }}
          title={message.account_name}
        />
        {/* Unread state, account, and attachments are otherwise conveyed only
            visually (font weight, colored dot, icon). */}
        <span className="sr-only">
          {message.is_seen ? "" : "Unread. "}
          {`Account ${message.account_name}.`}
          {message.has_attachments ? " Has attachments." : ""}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span
              className={`truncate text-sm ${message.is_seen ? "font-normal text-gray-700 dark:text-gray-300" : "font-semibold text-gray-900 dark:text-white"}`}
            >
              {message.from_name || message.from_addr || "(unknown sender)"}
            </span>
            <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
              {formatDate(message.date_sent)}
            </span>
          </span>
          <span
            className={`block truncate text-sm ${message.is_seen ? "text-gray-600 dark:text-gray-400" : "font-medium text-gray-900 dark:text-white"}`}
          >
            {message.subject || "(no subject)"}
          </span>
          <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
            {message.snippet}
          </span>
        </span>
      </button>
      {message.has_attachments && (
        <span className="mt-1.5 shrink-0 text-gray-500 dark:text-gray-400" title="Has attachments">
          <PaperclipIcon className="h-3.5 w-3.5" />
        </span>
      )}
      <button
        onClick={onDelete}
        tabIndex={-1}
        title="Delete"
        aria-label="Delete message"
        className="mt-1 shrink-0 rounded p-1 text-gray-400 opacity-0 transition-opacity hover:text-red-600 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 dark:text-gray-500 dark:hover:text-red-400"
      >
        <TrashIcon />
      </button>
    </li>
  );
}
