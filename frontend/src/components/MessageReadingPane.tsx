import { useMemo } from "react";

import { useMessage } from "../api/useMessages";
import type { MessageSummary } from "../api/types";
import { useUiStore } from "../store/uiStore";
import { PaperclipIcon } from "./icons";

function buildQuotedHtml(detail: { from_name: string | null; from_addr: string | null; date_sent: string | null; html_body: string | null; text_body: string | null }) {
  const who = detail.from_name || detail.from_addr || "them";
  const when = detail.date_sent ? new Date(detail.date_sent).toLocaleString() : "";
  const body = detail.html_body ?? `<pre>${detail.text_body ?? ""}</pre>`;
  return `<p>On ${when}, ${who} wrote:</p><blockquote style="border-left:2px solid #ccc;padding-left:10px;margin-left:0;color:#555;">${body}</blockquote>`;
}

export default function MessageReadingPane({
  summary,
  onDelete,
}: {
  summary: MessageSummary | null;
  onDelete: (id: number) => void;
}) {
  const { data: detail, isLoading } = useMessage(summary?.id ?? null);
  const openReply = useUiStore((s) => s.openReply);

  const srcDoc = useMemo(() => {
    if (!detail) return "";
    const body = detail.html_body ?? `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(detail.text_body ?? "")}</pre>`;
    return `<html><head><base target="_blank"></head><body style="margin:0;font-family:system-ui,sans-serif;font-size:14px;">${body}</body></html>`;
  }, [detail]);

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Select a message to read it
      </div>
    );
  }

  if (isLoading || !detail) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b glass-divider px-6 py-4">
        <h2 className="text-lg font-semibold">{detail.subject || "(no subject)"}</h2>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: summary.account_color }}
          />
          <span className="shrink-0">{summary.account_name}</span>
          <span aria-hidden="true">&middot;</span>
          <span>
            {detail.from_name} &lt;{detail.from_addr}&gt;
          </span>
          <span>&middot;</span>
          <span>{detail.date_sent ? new Date(detail.date_sent).toLocaleString() : ""}</span>
        </div>
        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          To: {detail.to_addrs.join(", ")}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <iframe title="message-body" sandbox="" srcDoc={srcDoc} className="h-full w-full" />
      </div>

      {detail.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 glass-divider border-t px-6 py-3">
          {detail.attachments.map((a) => (
            <a
              key={a.part_index}
              href={`/api/messages/${summary.id}/attachments/${a.part_index}`}
              className="glass-button inline-flex items-center gap-1.5 py-1"
              download
            >
              <PaperclipIcon className="h-3.5 w-3.5" /> {a.filename || "attachment"}
            </a>
          ))}
        </div>
      )}

      <div className="glass-divider flex items-center justify-between border-t px-6 py-3">
        <button
          onClick={() =>
            openReply({
              replyToMessageId: summary.id,
              defaultAccountId: summary.account_id,
              defaultTo: detail.from_addr ? [detail.from_addr] : [],
              defaultSubject: detail.subject?.startsWith("Re:")
                ? detail.subject
                : `Re: ${detail.subject ?? ""}`,
              quotedHtml: buildQuotedHtml(detail),
            })
          }
          className="glass-button-primary"
        >
          Reply
        </button>
        <button
          onClick={() => onDelete(summary.id)}
          className="rounded-full border border-red-200 bg-red-50/90 px-4 py-2 text-sm font-medium text-red-700 backdrop-blur-md transition hover:bg-red-100 dark:border-red-400/30 dark:bg-red-400/15 dark:text-red-300 dark:hover:bg-red-400/25"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
