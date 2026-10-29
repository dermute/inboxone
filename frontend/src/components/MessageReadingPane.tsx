import { useMemo } from "react";

import { api } from "../api/client";
import { toast } from "../store/toastStore";
import { useMessage } from "../api/useMessages";
import { useUiStore } from "../store/uiStore";
import { ArrowLeftIcon, PaperclipIcon } from "./icons";
import Skeleton from "./Skeleton";

function buildQuotedHtml(detail: { from_name: string | null; from_addr: string | null; date_sent: string | null; html_body: string | null; text_body: string | null }) {
  const who = detail.from_name || detail.from_addr || "them";
  const when = detail.date_sent ? new Date(detail.date_sent).toLocaleString() : "";
  const body = detail.html_body ?? `<pre>${detail.text_body ?? ""}</pre>`;
  return `<p>On ${when}, ${who} wrote:</p><blockquote style="border-left:2px solid #ccc;padding-left:10px;margin-left:0;color:#555;">${body}</blockquote>`;
}

function buildForwardedHtml(detail: {
  subject: string | null;
  from_name: string | null;
  from_addr: string | null;
  to_addrs: string[];
  date_sent: string | null;
  html_body: string | null;
  text_body: string | null;
}) {
  const from = detail.from_name
    ? `${detail.from_name} <${detail.from_addr ?? ""}>`
    : (detail.from_addr ?? "");
  const when = detail.date_sent ? new Date(detail.date_sent).toLocaleString() : "";
  const body = detail.html_body ?? `<pre>${escapeHtml(detail.text_body ?? "")}</pre>`;
  return `<p><br></p><p>---------- Forwarded message ---------</p><p><strong>From:</strong> ${escapeHtml(from)}<br><strong>Date:</strong> ${escapeHtml(when)}<br><strong>Subject:</strong> ${escapeHtml(detail.subject ?? "")}<br><strong>To:</strong> ${escapeHtml(detail.to_addrs.join(", "))}</p>${body}`;
}

export default function MessageReadingPane({
  messageId,
  onDelete,
  onBack,
}: {
  messageId: number | null;
  onDelete: (id: number) => void;
  /* Below lg the pane replaces the list, so it needs a way back. */
  onBack: () => void;
}) {
  const { data: detail, isLoading, isError, error, refetch } = useMessage(messageId);
  const openReply = useUiStore((s) => s.openReply);
  const openForward = useUiStore((s) => s.openForward);

  const srcDoc = useMemo(() => {
    if (!detail) return "";
    const body = detail.html_body ?? `<pre style="white-space:pre-wrap;font-family:inherit;">${escapeHtml(detail.text_body ?? "")}</pre>`;
    // Iframe canvases are transparent by default, so without an explicit
    // background a mail that doesn't set its own renders black default text
    // over the dark glass panel. Mail is designed against white - force it.
    return `<html><head><meta name="color-scheme" content="light"><base target="_blank"></head><body style="margin:0;padding:12px;background:#fff;color:#111;font-family:system-ui,sans-serif;font-size:14px;">${body}</body></html>`;
  }, [detail]);

  if (messageId === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-600 dark:text-gray-300">
        Select a message to read it
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p>{error instanceof Error ? error.message : "Could not load this message."}</p>
        <button onClick={() => refetch()} className="glass-button">Retry</button>
        <button onClick={onBack} className="glass-button">Back to message list</button>
      </div>
    );
  }

  if (isLoading || !detail) {
    return (
      <div aria-label="Loading message" role="status" className="flex h-full flex-col">
        <div className="glass-divider space-y-2.5 border-b px-6 py-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="space-y-3 px-6 py-5">
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-11/12" />
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-2/3" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="glass-divider flex items-start gap-2 border-b px-4 py-4 lg:px-6">
        <button
          onClick={onBack}
          aria-label="Back to message list"
          className="mt-0.5 shrink-0 rounded p-1 text-gray-600 dark:text-gray-300 lg:hidden"
        >
          <ArrowLeftIcon />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{detail.subject || "(no subject)"}</h2>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-gray-600 dark:text-gray-400">
            <span
              aria-hidden="true"
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: detail.account_color }}
            />
            <span className="shrink-0">{detail.account_name}</span>
            <span aria-hidden="true">&middot;</span>
            <span>
              {detail.from_name} &lt;{detail.from_addr}&gt;
            </span>
            <span>&middot;</span>
            <span>{detail.date_sent ? new Date(detail.date_sent).toLocaleString() : ""}</span>
          </div>
          <div className="mt-1 text-xs text-gray-600 dark:text-gray-300">
            To: {detail.to_addrs.join(", ")}
          </div>
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
              href={`/api/messages/${detail.id}/attachments/${a.part_index}`}
              className="glass-button inline-flex items-center gap-1.5 py-1"
              download
              onClick={async (event) => {
                event.preventDefault();
                try {
                  const blob = await api.download(`/api/messages/${detail.id}/attachments/${a.part_index}`);
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = a.filename || "attachment";
                  link.click();
                  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) {
                  toast(error instanceof Error ? error.message : "Could not download attachment");
                }
              }}
            >
              <PaperclipIcon className="h-3.5 w-3.5" /> {a.filename || "attachment"}
            </a>
          ))}
        </div>
      )}

      <div className="glass-divider flex items-center justify-between border-t px-6 py-3">
        <div className="flex gap-2">
          <button
            onClick={() =>
              openReply({
                sourceMessageId: detail.id,
                defaultAccountId: detail.account_id,
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
            onClick={() =>
              openForward({
                sourceMessageId: detail.id,
                defaultAccountId: detail.account_id,
                defaultTo: [],
                defaultSubject: /^Fwd:/i.test(detail.subject ?? "")
                  ? (detail.subject ?? "")
                  : `Fwd: ${detail.subject ?? ""}`,
                quotedHtml: buildForwardedHtml(detail),
              })
            }
            className="glass-button"
          >
            Forward
          </button>
        </div>
        <button onClick={() => onDelete(detail.id)} className="glass-button-danger">
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
