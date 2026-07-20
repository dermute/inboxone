import * as Dialog from "@radix-ui/react-dialog";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";

import { useAccounts } from "../api/useAccounts";
import { ApiError } from "../api/client";
import { useReply } from "../api/useMessages";
import { useUiStore } from "../store/uiStore";
import ConfirmDialog from "./ConfirmDialog";
import { XIcon } from "./icons";

function parseAddrs(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ComposeModal() {
  const compose = useUiStore((s) => s.compose);
  const closeCompose = useUiStore((s) => s.closeCompose);
  const { data: accounts } = useAccounts();
  const reply = useReply();

  const [accountId, setAccountId] = useState<number | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirtyRef = useRef(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
    onUpdate: () => {
      dirtyRef.current = true;
    },
  });

  useEffect(() => {
    if (!compose.open) return;
    setAccountId(compose.defaultAccountId);
    setTo(compose.defaultTo.join(", "));
    setCc("");
    setSubject(compose.defaultSubject);
    setSendError(null);
    setConfirmDiscard(false);
    // setContent doesn't emit an update event, so this doesn't mark the draft dirty.
    editor?.commands.setContent(`<p></p>${compose.quotedHtml}`);
    dirtyRef.current = false;
  }, [compose.open]);

  if (!compose.open) return null;

  function markDirty() {
    dirtyRef.current = true;
  }

  // Esc, overlay click, the X, and Cancel all land here - a dirty draft asks
  // for confirmation instead of being silently thrown away.
  function requestClose() {
    if (dirtyRef.current) setConfirmDiscard(true);
    else closeCompose();
  }

  async function handleSend() {
    if (!compose.replyToMessageId || !editor) return;
    const toAddrs = parseAddrs(to);
    if (toAddrs.length === 0) {
      setSendError("Add at least one recipient.");
      return;
    }
    setSendError(null);
    try {
      await reply.mutateAsync({
        id: compose.replyToMessageId,
        accountId: accountId ?? undefined,
        to: toAddrs,
        cc: parseAddrs(cc),
        subject,
        bodyHtml: editor.getHTML(),
      });
      closeCompose();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : "Failed to send - try again.");
    }
  }

  return (
    <Dialog.Root open={compose.open} onOpenChange={(open) => !open && requestClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="glass-panel fixed left-1/2 top-1/2 flex h-[80vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden">
          <div className="glass-divider flex items-center justify-between border-b px-5 py-3">
            <Dialog.Title className="font-medium">New message</Dialog.Title>
            <Dialog.Description className="sr-only">
              Write and send a reply to this message.
            </Dialog.Description>
            <Dialog.Close
              aria-label="Close"
              className="rounded p-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <XIcon />
            </Dialog.Close>
          </div>

          <div className="space-y-2 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="compose-from" className="w-16 text-gray-600 dark:text-gray-400">
                From
              </label>
              <select
                id="compose-from"
                value={accountId ?? ""}
                onChange={(e) => {
                  setAccountId(Number(e.target.value));
                  markDirty();
                }}
                className="input flex-1"
              >
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="compose-to" className="w-16 text-gray-600 dark:text-gray-400">
                To
              </label>
              <input
                id="compose-to"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  markDirty();
                }}
                className="input flex-1"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="compose-cc" className="w-16 text-gray-600 dark:text-gray-400">
                Cc
              </label>
              <input
                id="compose-cc"
                value={cc}
                onChange={(e) => {
                  setCc(e.target.value);
                  markDirty();
                }}
                className="input flex-1"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="compose-subject" className="w-16 text-gray-600 dark:text-gray-400">
                Subject
              </label>
              <input
                id="compose-subject"
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                  markDirty();
                }}
                className="input flex-1"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto glass-divider border-t px-5 py-3">
            <EditorContent editor={editor} className="prose prose-sm max-w-none dark:prose-invert" />
          </div>

          <div className="glass-divider flex items-center justify-between gap-2 border-t px-5 py-3">
            <p role="alert" className="min-w-0 truncate text-sm text-red-600 dark:text-red-400">
              {sendError}
            </p>
            <div className="flex shrink-0 gap-2">
              <button onClick={requestClose} className="glass-button">
                Cancel
              </button>
              <button onClick={handleSend} disabled={reply.isPending} className="glass-button-primary">
                {reply.isPending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>

          <ConfirmDialog
            open={confirmDiscard}
            onOpenChange={setConfirmDiscard}
            title="Discard draft?"
            description="Your reply hasn't been sent and will be lost."
            confirmLabel="Discard"
            cancelLabel="Keep editing"
            destructive
            onConfirm={closeCompose}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
