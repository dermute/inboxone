import { useEffect } from "react";

import { useAccounts } from "../api/useAccounts";

// Renders nothing - mirrors the total unread count into the document title
// so it's visible on the browser tab.
export default function TabTitleUnread() {
  const { data: accounts } = useAccounts();

  useEffect(() => {
    const total = (accounts ?? []).reduce(
      (sum, account) => sum + account.folders.reduce((s, f) => s + f.unread_count, 0),
      0
    );
    document.title = total > 0 ? `(${total}) inboxone` : "inboxone";
    return () => {
      document.title = "inboxone";
    };
  }, [accounts]);

  return null;
}
