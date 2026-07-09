import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";

import { useCreateAccount } from "../api/useAccounts";
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
};

export default function AccountEditorModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tab, setTab] = useState<"basic" | "microsoft">("basic");
  const [form, setForm] = useState(emptyForm);
  const createAccount = useCreateAccount();
  const [createdId, setCreatedId] = useState<number | null>(null);

  function update<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function reset() {
    setForm(emptyForm);
    setTab("basic");
    setCreatedId(null);
  }

  async function handleCreate() {
    const account = await createAccount.mutateAsync(form);
    setCreatedId(account.id);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="glass-panel fixed left-1/2 top-1/2 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-6">
          <Dialog.Title className="mb-4 text-lg font-semibold">Add account</Dialog.Title>

          {createdId ? (
            <div className="space-y-3 text-sm">
              <p className="font-medium text-green-700 dark:text-green-400">Account added.</p>
              <button onClick={() => onOpenChange(false)} className="glass-button-primary">
                Done
              </button>
            </div>
          ) : (
            <>
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

              {tab === "microsoft" ? (
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
                      className="input"
                    />
                  </Field>

                  {createAccount.isError && (
                    <p className="text-red-600">Failed to save account - check the details and try again.</p>
                  )}

                  <div className="flex justify-end gap-2 pt-2">
                    <button onClick={() => onOpenChange(false)} className="glass-button">
                      Cancel
                    </button>
                    <button
                      onClick={handleCreate}
                      disabled={createAccount.isPending || !form.name || !form.imap_host}
                      className="glass-button-primary"
                    >
                      {createAccount.isPending ? "Saving..." : "Save account"}
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
