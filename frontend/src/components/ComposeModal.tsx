import * as Dialog from "@radix-ui/react-dialog";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useState } from "react";

import { useAccounts } from "../api/useAccounts";
import { useReply } from "../api/useMessages";
import { useUiStore } from "../store/uiStore";

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

  const editor = useEditor({
    extensions: [StarterKit],
    content: "",
  });

  useEffect(() => {
    if (!compose.open) return;
    setAccountId(compose.defaultAccountId);
    setTo(compose.defaultTo.join(", "));
    setCc("");
    setSubject(compose.defaultSubject);
    editor?.commands.setContent(`<p></p>${compose.quotedHtml}`);
  }, [compose.open]);

  if (!compose.open) return null;

  async function handleSend() {
    if (!compose.replyToMessageId || !editor) return;
    await reply.mutateAsync({
      id: compose.replyToMessageId,
      accountId: accountId ?? undefined,
      to: parseAddrs(to),
      cc: parseAddrs(cc),
      subject,
      bodyHtml: editor.getHTML(),
    });
    closeCompose();
  }

  return (
    <Dialog.Root open={compose.open} onOpenChange={(open) => !open && closeCompose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 flex h-[80vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl bg-white shadow-xl dark:bg-neutral-800">
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 dark:border-neutral-700">
            <Dialog.Title className="font-medium">New message</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600">✕</Dialog.Close>
          </div>

          <div className="space-y-2 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">From</span>
              <select
                value={accountId ?? ""}
                onChange={(e) => setAccountId(Number(e.target.value))}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 dark:border-neutral-600 dark:bg-neutral-700"
              >
                {accounts?.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">To</span>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 dark:border-neutral-600 dark:bg-neutral-700"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">Cc</span>
              <input
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 dark:border-neutral-600 dark:bg-neutral-700"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 dark:border-neutral-600 dark:bg-neutral-700"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border-t border-gray-100 px-5 py-3 dark:border-neutral-700">
            <EditorContent editor={editor} className="prose prose-sm max-w-none dark:prose-invert" />
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-neutral-700">
            <button
              onClick={closeCompose}
              className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-neutral-700"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={reply.isPending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {reply.isPending ? "Sending..." : "Send"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
