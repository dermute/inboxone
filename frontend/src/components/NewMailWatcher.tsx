import { useEffect, useRef } from "react";

import { useAccounts } from "../api/useAccounts";
import { inboxFolders } from "../api/inboxes";
import { useRecentUnread } from "../api/useMessages";
import type { MessageSummary } from "../api/types";
import { navigationRef } from "../store/navigation";
import { useNotificationStore } from "../store/notificationStore";
import { useUiStore } from "../store/uiStore";

function notifyNewMessage(message: MessageSummary): void {
  const sender = message.from_name || message.from_addr || "Unknown sender";
  const notification = new Notification(message.subject || "(no subject)", {
    body: `From ${sender} · ${message.account_name}`,
    tag: `message-${message.id}`,
    icon: "/favicon.svg",
  });
  notification.onclick = () => {
    navigationRef.current?.("/inbox");
    const ui = useUiStore.getState();
    ui.setSelectedAccountId(message.account_id);
    ui.setSelectedFolderId(message.folder_id);
    ui.setSelectedMessageId(message.id);
    window.focus();
    notification.close();
  };
}

// Observe event-refreshed unread mail across marked inboxes, including hidden tabs.
// Notify only messages added after this session's initial cache baseline.
export default function NewMailWatcher() {
  const enabled = useNotificationStore((s) => s.enabled);
  const { data: accounts } = useAccounts();
  const membership = accounts?.flatMap(inboxFolders)
    .map((folder) => folder.id).sort((a, b) => a - b).join(",") ?? "";
  const { data } = useRecentUnread(membership);
  const previousMembership = useRef(membership);
  const seenIds = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (previousMembership.current !== membership) {
      seenIds.current = null;
      previousMembership.current = membership;
    }
    if (!data) return;
    // Also enforce the current selection locally in case a response predates a
    // folder being unmarked or the accounts query has not loaded yet.
    const inboxIds = new Set(membership.split(",").filter(Boolean).map(Number));
    const messages = data.items.filter((message) => inboxIds.has(message.folder_id));
    const currentIds = new Set(messages.map((m) => m.id));

    if (seenIds.current === null) {
      // First response of the session: record the baseline without notifying, so opening
      // the app never fires a wall of notifications for mail that was already unread.
      seenIds.current = currentIds;
      return;
    }

    const canNotify =
      enabled && typeof Notification !== "undefined" && Notification.permission === "granted";

    if (canNotify) {
      for (const message of messages) {
        if (!seenIds.current.has(message.id)) {
          notifyNewMessage(message);
        }
      }
    }

    seenIds.current = currentIds;
  }, [data, enabled, membership]);

  return null;
}
