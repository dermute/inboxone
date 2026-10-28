import type { Account, Folder } from "./types";

export function inboxFolders(account: Account): Folder[] {
  return account.folders.filter((folder) => folder.is_inbox);
}

export function inboxUnreadCount(account: Account): number {
  return inboxFolders(account).reduce((sum, folder) => sum + folder.unread_count, 0);
}
