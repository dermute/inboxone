import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";

import { useCreateAccount, useUpdateAccount } from "../api/useAccounts";
import type { Account, AccountCreateBasic } from "../api/types";
import OAuthMicrosoftLinkFlow from "./OAuthMicrosoftLinkFlow";

const emptyForm = {
  name: "",
  color: "#4F46E5",
  imap_host: "",
  imap_port: 993,
  imap_use_tls: true,
  imap_username: "",
  imap_password: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_use_tls: true,
  smtp_username: "",
  smtp_password: "",
  sync_interval_seconds: "",
  is_active: true,
};

export default function AccountEditorModal({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account?: Account | null;
}) {
  const isEdit = !!account;
  const [tab, setTab] = useState<"basic" | "microsoft">("basic");
  const [form, setForm] = useState(emptyForm);
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const [createdId, setCreatedId] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    if (account) {
      setForm({
        name: account.name,
        color: account.color,
        imap_host: account.imap_host ?? "",
        imap_port: account.imap_port ?? 993,
        imap_use_tls: account.imap_use_tls,
        imap_username: account.imap_username ?? "",
        imap_password: "",
        smtp_host: account.smtp_host ?? "",
        smtp_port: account.smtp_port ?? 587,
        smtp_use_tls: account.smtp_use_tls,
        smtp_username: account.smtp_username ?? "",
        smtp_password: "",
        sync_interval_seconds:
          account.sync_interval_seconds != null ? String(account.sync_interval_seconds) : "",
        is_active: account.is_active,
      });
    } else {
      setForm(emptyForm);
    }
    setTab("basic");
    setCreatedId(null);
  }, [open, account]);

  function update<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleCreate() {
    const created = await createAccount.mutateAsync({
      name: form.name,
      color: form.color,
      imap_host: form.imap_host,
      imap_port: form.imap_port,
      imap_use_tls: form.imap_use_tls,
      imap_username: form.imap_username,
      imap_password: form.imap_password,
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_use_tls: form.smtp_use_tls,
      smtp_username: form.smtp_username,
      smtp_password: form.smtp_password,
      sync_interval_seconds: form.sync_interval_seconds ? Number(form.sync_interval_seconds) : undefined,
    });
    setCreatedId(created.id);
  }

  async function handleUpdateBasic() {
    if (!account) return;
    const payload: Partial<AccountCreateBasic> & { is_active?: boolean } = {
      name: form.name,
      color: form.color,
      imap_host: form.imap_host,
      imap_port: form.imap_port,
      imap_use_tls: form.imap_use_tls,
      imap_username: form.imap_username,
      smtp_host: form.smtp_host,
      smtp_port: form.smtp_port,
      smtp_use_tls: form.smtp_use_tls,
      smtp_username: form.smtp_username,
      sync_interval_seconds: form.sync_interval_seconds ? Number(form.sync_interval_seconds) : null,
      is_active: form.is_active,
    };
    if (form.imap_password) payload.imap_password = form.imap_password;
    if (form.smtp_password) payload.smtp_password = form.smtp_password;
    await updateAccount.mutateAsync({ id: account.id, payload });
    onOpenChange(false);
  }

  async function handleUpdateOAuthMeta() {
    if (!account) return;
    const payload: Partial<AccountCreateBasic> & { is_active?: boolean } = {
      name: form.name,
      color: form.color,
      sync_interval_seconds: form.sync_interval_seconds ? Number(form.sync_interval_seconds) : null,
      is_active: form.is_active,
    };
    await updateAccount.mutateAsync({ id: account.id, payload });
    onOpenChange(false);
  }

  const showOAuthEditView = isEdit && account?.protocol === "oauth_microsoft";
  const showOAuthCreateView = !isEdit && tab === "microsoft";
  const isSaving = isEdit ? updateAccount.isPending : createAccount.isPending;
  const hasError = isEdit ? updateAccount.isError : createAccount.isError;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="glass-panel fixed left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-6">
          <Dialog.Title className="mb-4 text-lg font-semibold">
            {isEdit ? "Edit account" : "Add account"}
          </Dialog.Title>

          {createdId ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-green-700 dark:text-green-400">Account added.</p>
              <button onClick={() => onOpenChange(false)} className="glass-button-primary">
                Done
              </button>
            </div>
          ) : (
            <>
              {!isEdit && (
                <div className="glass-divider mb-4 flex gap-2 border-b">
                  <button
                    onClick={() => setTab("basic")}
                    className={`px-3 py-2 text-sm ${tab === "basic" ? "border-b-2 border-indigo-600 font-medium text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}
                  >
                    Generic IMAP/SMTP
                  </button>
                  <button
                    onClick={() => setTab("microsoft")}
                    className={`px-3 py-2 text-sm ${tab === "microsoft" ? "border-b-2 border-indigo-600 font-medium text-gray-900 dark:text-white" : "text-gray-600 dark:text-gray-400"}`}
                  >
                    Outlook / Microsoft 365
                  </button>
                </div>
              )}

              {showOAuthEditView ? (
                <div className="max-h-[70vh] space-y-3 overflow-y-auto text-sm">
                  <Field label="Name">
                    <input value={form.name} onChange={(e) => update("name", e.target.value)} className="input" />
                  </Field>
                  <Field label="Color">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => update("color", e.target.value)}
                      className="h-8 w-14 rounded-lg border border-black/10 bg-white/70 dark:border-white/10 dark:bg-white/10"
                    />
                  </Field>
                  <Field label="Sync every">
                    <input
                      type="number"
                      min={30}
                      value={form.sync_interval_seconds}
                      onChange={(e) => update("sync_interval_seconds", e.target.value)}
                      placeholder="Default (seconds)"
                      className="input"
                    />
                  </Field>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.is_active}
                      onChange={(e) => update("is_active", e.target.checked)}
                    />
                    Active (uncheck to pause syncing without removing the account)
                  </label>

                  {hasError && (
                    <p className="text-red-600">Failed to save changes - check the details and try again.</p>
                  )}

                  <div className="glass-divider border-t pt-3">
                    <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                      Connected as {account?.imap_username ?? "unknown"}. If sign-in has expired or
                      been revoked, reconnect below.
                    </p>
                    <OAuthMicrosoftLinkFlow
                      reconnectAccountId={account!.id}
                      onDone={() => onOpenChange(false)}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => onOpenChange(false)} className="glass-button">
                      Cancel
                    </button>
                    <button
                      onClick={handleUpdateOAuthMeta}
                      disabled={isSaving || !form.name}
                      className="glass-button-primary"
                    >
                      {isSaving ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              ) : showOAuthCreateView ? (
                <OAuthMicrosoftLinkFlow onDone={() => onOpenChange(false)} />
              ) : (
                <div className="max-h-[60vh] space-y-3 overflow-y-auto text-sm">
                  <Field label="Name">
                    <input value={form.name} onChange={(e) => update("name", e.target.value)} className="input" />
                  </Field>
                  <Field label="Color">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => update("color", e.target.value)}
                      className="h-8 w-14 rounded-lg border border-black/10 bg-white/70 dark:border-white/10 dark:bg-white/10"
                    />
                  </Field>
                  <p className="pt-2 font-medium text-gray-600 dark:text-gray-400">IMAP (receiving)</p>
                  <Field label="Host">
                    <input value={form.imap_host} onChange={(e) => update("imap_host", e.target.value)} className="input" />
                  </Field>
                  <Field label="Port">
                    <input
                      type="number"
                      value={form.imap_port}
                      onChange={(e) => update("imap_port", Number(e.target.value))}
                      className="input"
                    />
                  </Field>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.imap_use_tls}
                      onChange={(e) => update("imap_use_tls", e.target.checked)}
                    />
                    Use TLS
                  </label>
                  <Field label="Username">
                    <input
                      value={form.imap_username}
                      onChange={(e) => update("imap_username", e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={form.imap_password}
                      onChange={(e) => update("imap_password", e.target.value)}
                      placeholder={isEdit ? "Leave blank to keep the current password" : undefined}
                      className="input"
                    />
                  </Field>
                  <p className="pt-2 font-medium text-gray-600 dark:text-gray-400">SMTP (sending)</p>
                  <Field label="Host">
                    <input value={form.smtp_host} onChange={(e) => update("smtp_host", e.target.value)} className="input" />
                  </Field>
                  <Field label="Port">
                    <input
                      type="number"
                      value={form.smtp_port}
                      onChange={(e) => update("smtp_port", Number(e.target.value))}
                      className="input"
                    />
                  </Field>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.smtp_use_tls}
                      onChange={(e) => update("smtp_use_tls", e.target.checked)}
                    />
                    Use TLS
                  </label>
                  <Field label="Username">
                    <input
                      value={form.smtp_username}
                      onChange={(e) => update("smtp_username", e.target.value)}
                      className="input"
                    />
                  </Field>
                  <Field label="Password">
                    <input
                      type="password"
                      value={form.smtp_password}
                      onChange={(e) => update("smtp_password", e.target.value)}
                      placeholder={isEdit ? "Leave blank to keep the current password" : undefined}
                      className="input"
                    />
                  </Field>
                  <Field label="Sync every">
                    <input
                      type="number"
                      min={30}
                      value={form.sync_interval_seconds}
                      onChange={(e) => update("sync_interval_seconds", e.target.value)}
                      placeholder="Default (seconds)"
                      className="input"
                    />
                  </Field>
                  {isEdit && (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.is_active}
                        onChange={(e) => update("is_active", e.target.checked)}
                      />
                      Active (uncheck to pause syncing without removing the account)
                    </label>
                  )}

                  {hasError && (
                    <p className="text-red-600">
                      Failed to save {isEdit ? "changes" : "account"} - check the details and try again.
                    </p>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => onOpenChange(false)} className="glass-button">
                      Cancel
                    </button>
                    <button
                      onClick={isEdit ? handleUpdateBasic : handleCreate}
                      disabled={isSaving || !form.name || !form.imap_host}
                      className="glass-button-primary"
                    >
                      {isSaving ? "Saving..." : isEdit ? "Save changes" : "Save account"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}
