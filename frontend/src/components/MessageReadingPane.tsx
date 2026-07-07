import { useMemo } from "react";

import { useMessage } from "../api/useMessages";
import type { MessageSummary } from "../api/types";
import { useUiStore } from "../store/uiStore";

function buildQuotedHtml(detail: { from_name: string | null; from_addr: string | null; date_sent: string | null; html_body: string | null; text_body: string | null }) {
  const who = detail.from_name || detail.from_addr || "them";
  const when = detail.date_sent ? new Date(detail.date_sent).toLocaleString() : "";
  const body = detail.html_body ?? `<pre>${detail.text_body ?? ""}</pre>`;
  return `<p>On ${when}, ${who} wrote:</p><blockquote style="border-left:2px solid #ccc;padding-left:10px;margin-left:0;color:#555;">${body}</blockquote>`;
}

export default function MessageReadingPane({ summary }: { summary: MessageSummary | null }) {
  const { data: detail, isLoading } = useMessage(summary?.id ?? null);
  const openReply = useUiStore((s) => s.openReply);

  const srcDoc = useMemo(() => {
    if (!detail) return "";
    const body = detail.html_body ?? `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(detail.text_body ?? "")}</pre>`;
    return `<html><head><base target="_blank"></head><body style="margin:0;font-family:system-ui,sans-serif;font-size:14px;">${body}</body></html>`;
  }, [detail]);

  if (!summary) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-400">
        Select a message to read it
      </div>
    );
  }

  if (isLoading || !detail) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading...</div>;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-100 px-6 py-4 dark:border-neutral-800">
        <h2 className="text-lg font-semibold">{detail.subject || "(no subject)"}</h2>
        <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: summary.account_color }}
          />
          <span>
            {detail.from_name} &lt;{detail.from_addr}&gt;
          </span>
          <span>&middot;</span>
          <span>{detail.date_sent ? new Date(detail.date_sent).toLocaleString() : ""}</span>
        </div>
        <div className="mt-1 text-xs text-gray-400">To: {detail.to_addrs.join(", ")}</div>
      </div>

      <div className="flex-1 overflow-hidden">
        <iframe title="message-body" sandbox="" srcDoc={srcDoc} className="h-full w-full" />
      </div>

      {detail.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-gray-100 px-6 py-3 dark:border-neutral-800">
          {detail.attachments.map((a) => (
            <a
              key={a.part_index}
              href={`/api/messages/${summary.id}/attachments/${a.part_index}`}
              className="rounded-full border border-gray-200 px-3 py-1 text-xs hover:bg-gray-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              download
            >
              📎 {a.filename || "attachment"}
            </a>
          ))}
        </div>
      )}

      <div className="border-t border-gray-100 px-6 py-3 dark:border-neutral-800">
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
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Reply
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
