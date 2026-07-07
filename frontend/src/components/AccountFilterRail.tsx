import { Link } from "react-router-dom";

import type { Account } from "../api/types";

export default function AccountFilterRail({
  accounts,
  selectedAccountId,
  onSelect,
}: {
  accounts: Account[];
  selectedAccountId: number | null;
  onSelect: (id: number | null) => void;
}) {
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
        {accounts.map((account) => (
          <button
            key={account.id}
            onClick={() => onSelect(account.id)}
            className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              selectedAccountId === account.id
                ? "bg-indigo-50 font-medium text-indigo-700 dark:bg-neutral-700 dark:text-white"
                : "text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-800"
            }`}
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: account.color }}
            />
            <span className="truncate">{account.name}</span>
            {account.last_sync_status === "error" && (
              <span title={account.last_sync_error ?? "Sync error"} className="ml-auto text-red-500">
                !
              </span>
            )}
          </button>
        ))}
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
