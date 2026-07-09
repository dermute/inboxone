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
        <Dialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm" />
        <Dialog.Content className="glass-panel fixed left-1/2 top-1/2 flex h-[80vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-white/40 px-5 py-3 dark:border-white/10">
            <Dialog.Title className="font-medium">New message</Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-gray-600">✕</Dialog.Close>
          </div>

          <div className="space-y-2 px-5 py-3">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">From</span>
              <select
                value={accountId ?? ""}
                onChange={(e) => setAccountId(Number(e.target.value))}
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
              <span className="w-16 text-gray-500">To</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} className="input flex-1" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} className="input flex-1" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-500">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input flex-1"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto border-t border-white/40 px-5 py-3 dark:border-white/10">
            <EditorContent editor={editor} className="prose prose-sm max-w-none dark:prose-invert" />
          </div>

          <div className="flex justify-end gap-2 border-t border-white/40 px-5 py-3 dark:border-white/10">
            <button onClick={closeCompose} className="glass-button">
              Cancel
            </button>
            <button onClick={handleSend} disabled={reply.isPending} className="glass-button-primary">
              {reply.isPending ? "Sending..." : "Send"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
