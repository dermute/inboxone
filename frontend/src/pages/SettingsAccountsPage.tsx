import { useState } from "react";
import { Link } from "react-router-dom";

import {
  useAccountFolders,
  useAccounts,
  useDeleteAccount,
  useTestConnection,
  useUpdateAccountFolders,
} from "../api/useAccounts";
import AccountEditorModal from "../components/AccountEditorModal";
import type { Account } from "../api/types";

function FolderPicker({ account }: { account: Account }) {
  const { data: folders } = useAccountFolders(account.id);
  const updateFolders = useUpdateAccountFolders(account.id);

  if (!folders) return <p className="text-sm text-gray-400">Loading folders...</p>;

  function toggle(path: string, enabled: boolean) {
    const next = folders!.map((f) => ({
      imap_path: f.imap_path,
      sync_enabled: f.imap_path === path ? enabled : f.sync_enabled,
    }));
    updateFolders.mutate(next);
  }

  return (
    <div className="space-y-1">
      {folders.map((f) => (
        <label key={f.id} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={f.sync_enabled}
            onChange={(e) => toggle(f.imap_path, e.target.checked)}
          />
          {f.display_name || f.imap_path}
        </label>
      ))}
    </div>
  );
}

function AccountRow({ account }: { account: Account }) {
  const [expanded, setExpanded] = useState(false);
  const deleteAccount = useDeleteAccount();
  const testConnection = useTestConnection();

  return (
    <div className="glass-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: account.color }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{account.name}</div>
          <div className="truncate text-xs text-gray-400">
            {account.protocol === "oauth_microsoft" ? "Outlook / Microsoft 365" : account.imap_host}
          </div>
        </div>
        {account.last_sync_status && (
          <span
            className={`text-xs ${account.last_sync_status === "error" ? "text-red-500" : "text-gray-400"}`}
            title={account.last_sync_error ?? undefined}
          >
            {account.last_sync_status === "error" ? "sync error" : "synced"}
          </span>
        )}
        <button onClick={() => testConnection.mutate(account.id)} className="glass-button px-3 py-1 text-xs">
          Test
        </button>
        <button onClick={() => setExpanded((e) => !e)} className="glass-button px-3 py-1 text-xs">
          Folders
        </button>
        <button
          onClick={() => {
            if (confirm(`Remove account "${account.name}"?`)) deleteAccount.mutate(account.id);
          }}
          className="rounded-full border border-red-300/50 bg-red-50/40 px-3 py-1 text-xs text-red-600 backdrop-blur-md transition hover:bg-red-100/60 dark:border-red-400/20 dark:bg-red-400/10 dark:hover:bg-red-400/20"
        >
          Remove
        </button>
      </div>
      {testConnection.data && testConnection.variables === account.id && (
        <div className="border-t border-white/40 px-4 py-2 text-xs dark:border-white/10">
          <span className={testConnection.data.imap_ok ? "text-green-600" : "text-red-600"}>
            IMAP: {testConnection.data.imap_ok ? "OK" : testConnection.data.imap_error}
          </span>
          {testConnection.data.smtp_ok !== null && (
            <span className={`ml-4 ${testConnection.data.smtp_ok ? "text-green-600" : "text-red-600"}`}>
              SMTP: {testConnection.data.smtp_ok ? "OK" : testConnection.data.smtp_error}
            </span>
          )}
        </div>
      )}
      {expanded && (
        <div className="border-t border-white/40 px-4 py-3 dark:border-white/10">
          <FolderPicker account={account} />
        </div>
      )}
    </div>
  );
}

export default function SettingsAccountsPage() {
  const { data: accounts, isLoading } = useAccounts();
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link to="/inbox" className="text-sm text-gray-500 hover:underline">
            &larr; Back to inbox
          </Link>
          <h1 className="mt-1 text-xl font-semibold">Accounts</h1>
        </div>
        <button onClick={() => setModalOpen(true)} className="glass-button-primary">
          Add account
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading...</p>}

      <div className="space-y-3">
        {accounts?.map((account) => (
          <AccountRow key={account.id} account={account} />
        ))}
      </div>

      <AccountEditorModal open={modalOpen} onOpenChange={setModalOpen} />
    </div>
  );
}
