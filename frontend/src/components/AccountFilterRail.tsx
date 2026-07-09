import { useState } from "react";
import { Link } from "react-router-dom";

import type { Account } from "../api/types";

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto shrink-0 rounded-full bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
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
    <div className="flex h-full w-56 shrink-0 flex-col border-r border-gray-100 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="px-4 py-4">
        <h1 className="text-lg font-semibold">inboxone</h1>
      </div>
      <nav className="flex-1 overflow-y-auto px-2">
        <button
          onClick={() => onSelect(null)}
          className={`mb-1 flex w-full items-center rounded-lg px-3 py-2 text-sm ${
            selectedAccountId === null
              ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-neutral-700 dark:text-white"
              : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800"
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
                className={`flex w-full items-center gap-1 rounded-lg pr-2 text-sm ${
                  selectedAccountId === account.id && selectedFolderId === null
                    ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-neutral-700 dark:text-white"
                    : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800"
                }`}
              >
                <button
                  onClick={() =>
                    setExpanded((e) => ({ ...e, [account.id]: !e[account.id] }))
                  }
                  title={isExpanded ? "Collapse folders" : "Expand folders"}
                  className="shrink-0 rounded p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <span
                    className={`inline-block text-xs transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  >
                    &#9656;
                  </span>
                </button>
                <button
                  onClick={() => onSelect(account.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: account.color }}
                  />
                  <span className="truncate">{account.name}</span>
                </button>
                {account.last_sync_status === "error" ? (
                  <span title={account.last_sync_error ?? "Sync error"} className="shrink-0 text-red-500">
                    !
                  </span>
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
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${
                        selectedFolderId === folder.id
                          ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-neutral-700 dark:text-white"
                          : "text-gray-600 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-neutral-800"
                      }`}
                    >
                      <span className="truncate">{folder.display_name || folder.imap_path}</span>
                      <UnreadBadge count={folder.unread_count} />
                    </button>
                  ))}
                  {account.folders.length === 0 && (
                    <p className="px-3 py-1 text-xs text-gray-400">No folders synced</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-gray-100 p-2 dark:border-neutral-800">
        <Link
          to="/settings/accounts"
          className="block rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800"
        >
          Settings
        </Link>
      </div>
    </div>
  );
}
