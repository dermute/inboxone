import { useEffect, useRef } from "react";

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
  });
  notification.onclick = () => {
    navigationRef.current?.("/inbox");
    const ui = useUiStore.getState();
    ui.setSelectedAccountId(message.account_id);
    ui.setSelectedFolderId(null);
    ui.setSelectedMessageId(message.id);
    window.focus();
    notification.close();
  };
}

// Renders nothing - just polls for newly-arrived unread mail (across every account,
// regardless of what's currently on screen) and fires a browser notification for
// anything that wasn't there on the previous poll.
export default function NewMailWatcher() {
  const enabled = useNotificationStore((s) => s.enabled);
  const { data } = useRecentUnread();
  const seenIds = useRef<Set<number> | null>(null);

  useEffect(() => {
    if (!data) return;
    const currentIds = new Set(data.items.map((m) => m.id));

    if (seenIds.current === null) {
      // First poll of the session: record the baseline without notifying, so opening
      // the app never fires a wall of notifications for mail that was already unread.
      seenIds.current = currentIds;
      return;
    }

    const canNotify =
      enabled &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted" &&
      !document.hasFocus();

    if (canNotify) {
      for (const message of data.items) {
        if (!seenIds.current.has(message.id)) {
          notifyNewMessage(message);
        }
      }
    }

    seenIds.current = currentIds;
  }, [data, enabled]);

  return null;
}
