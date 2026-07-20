import { useState } from "react";
import { Link } from "react-router-dom";

import type { Account } from "../api/types";
import { toast } from "../store/toastStore";
import { ChevronRightIcon } from "./icons";
import NotificationToggle from "./NotificationToggle";
import ThemeToggle from "./ThemeToggle";

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span aria-label={`${count} unread`} className="glass-badge ml-auto shrink-0">
      {count}
    </span>
  );
}

function accountUnreadCount(account: Account): number {
  return account.folders.reduce((sum, f) => sum + f.unread_count, 0);
}

export default function AccountFilterRail({
  accounts,
  selectedAccountId,
  selectedFolderId,
  onSelect,
  onSelectFolder,
}: {
  accounts: Account[];
  selectedAccountId: number | null;
  selectedFolderId: number | null;
  onSelect: (id: number | null) => void;
  onSelectFolder: (accountId: number, folderId: number | null) => void;
}) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});

  return (
    <div className="glass-panel flex h-full w-60 shrink-0 flex-col overflow-hidden">
      <div className="px-4 py-4">
        <h1 className="text-lg font-semibold">inboxone</h1>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        <button
          onClick={() => onSelect(null)}
          className={`mb-1 flex w-full items-center rounded-2xl px-3 py-2 text-sm transition-colors ${
            selectedAccountId === null
              ? "glass-selected font-medium"
              : "text-gray-700 glass-hover dark:text-gray-300"
          }`}
        >
          All inboxes
        </button>
        {accounts.map((account) => {
          const isExpanded = !!expanded[account.id];
          const unread = accountUnreadCount(account);
          return (
            <div key={account.id} className="mb-1">
              <div
                className={`flex w-full items-center gap-1 rounded-2xl pr-2 text-sm transition-colors ${
                  selectedAccountId === account.id && selectedFolderId === null
                    ? "glass-selected font-medium"
                    : "text-gray-700 glass-hover dark:text-gray-300"
                }`}
              >
                <button
                  onClick={() =>
                    setExpanded((e) => ({ ...e, [account.id]: !e[account.id] }))
                  }
                  title={isExpanded ? "Collapse folders" : "Expand folders"}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} folders for ${account.name}`}
                  aria-expanded={isExpanded}
                  className="shrink-0 rounded-full p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <ChevronRightIcon
                    className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  />
                </button>
                <button
                  onClick={() => onSelect(account.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_6px_-1px_currentColor]"
                    style={{ backgroundColor: account.color, color: account.color }}
                  />
                  <span className="truncate">{account.name}</span>
                </button>
                {account.last_sync_status === "error" ? (
                  // A button, not a title-only span: keyboard and touch users
                  // have no other way to read the error message.
                  <button
                    onClick={() => toast(account.last_sync_error ?? "Sync error", { duration: 8000 })}
                    title={account.last_sync_error ?? "Sync error"}
                    aria-label={`Sync error for ${account.name}: ${account.last_sync_error ?? "unknown error"}`}
                    className="shrink-0 rounded px-1 font-bold text-red-600 dark:text-red-400"
                  >
                    !
                  </button>
                ) : (
                  <UnreadBadge count={unread} />
                )}
              </div>
              {isExpanded && (
                <div className="ml-6 mt-0.5 space-y-0.5">
                  {account.folders.map((folder) => (
                    <button
                      key={folder.id}
                      onClick={() => onSelectFolder(account.id, folder.id)}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-1.5 text-sm transition-colors ${
                        selectedFolderId === folder.id
                          ? "glass-selected font-medium"
                          : "text-gray-600 glass-hover dark:text-gray-400"
                      }`}
                    >
                      <span className="truncate">{folder.display_name || folder.imap_path}</span>
                      <UnreadBadge count={folder.unread_count} />
                    </button>
                  ))}
                  {account.folders.length === 0 && (
                    <p className="px-3 py-1 text-xs text-gray-500 dark:text-gray-400">No folders synced</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="glass-divider space-y-2 border-t p-2">
        <div className="flex gap-2">
          <div className="flex-1">
            <ThemeToggle />
          </div>
          <div className="flex-1">
            <NotificationToggle />
          </div>
        </div>
        <Link
          to="/settings/accounts"
          className="glass-hover block rounded-2xl px-3 py-2 text-sm text-gray-600 dark:text-gray-300"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}
