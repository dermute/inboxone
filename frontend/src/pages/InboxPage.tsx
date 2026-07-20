import { useMemo, useRef, useState } from "react";

import { useAccounts } from "../api/useAccounts";
import { ApiError } from "../api/client";
import { useDeleteMessage, useMarkAllRead, useMessages, useUpdateFlags } from "../api/useMessages";
import AccountFilterRail from "../components/AccountFilterRail";
import ComposeModal from "../components/ComposeModal";
import MessageList from "../components/MessageList";
import MessageReadingPane from "../components/MessageReadingPane";
import { toast } from "../store/toastStore";
import { useUiStore } from "../store/uiStore";

// The API delete moves the message to the server's Trash, which we can't undo
// from here - so "delete" only hides the message locally for a grace period
// and the actual API call happens once the undo window has passed.
const UNDO_WINDOW_MS = 5000;
// The API call fires slightly after the toast disappears, so a click on Undo
// at the last moment never races a delete that is already in flight.
const DELETE_COMMIT_MS = 5300;

export default function InboxPage() {
  const { data: accounts } = useAccounts();
  const selectedAccountId = useUiStore((s) => s.selectedAccountId);
  const setSelectedAccountId = useUiStore((s) => s.setSelectedAccountId);
  const selectedFolderId = useUiStore((s) => s.selectedFolderId);
  const setSelectedFolderId = useUiStore((s) => s.setSelectedFolderId);
  const selectedMessageId = useUiStore((s) => s.selectedMessageId);
  const setSelectedMessageId = useUiStore((s) => s.setSelectedMessageId);

  function selectAccount(id: number | null) {
    setSelectedAccountId(id);
    setSelectedFolderId(null);
  }

  function selectFolder(accountId: number, folderId: number | null) {
    setSelectedAccountId(accountId);
    setSelectedFolderId(folderId);
  }

  const messagesQuery = useMessages({ accountId: selectedAccountId, folderId: selectedFolderId });
  const updateFlags = useUpdateFlags();
  const markAllRead = useMarkAllRead();
  const deleteMessage = useDeleteMessage();
  const [pendingDeleteIds, setPendingDeleteIds] = useState<ReadonlySet<number>>(new Set());
  const deleteTimers = useRef(new Map<number, number>());

  const messages = useMemo(
    () =>
      (messagesQuery.data?.pages.flatMap((p) => p.items) ?? []).filter(
        (m) => !pendingDeleteIds.has(m.id)
      ),
    [messagesQuery.data, pendingDeleteIds]
  );
  const selectedSummary = messages.find((m) => m.id === selectedMessageId) ?? null;

  function removePending(id: number) {
    setPendingDeleteIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function handleDelete(id: number) {
    if (deleteTimers.current.has(id)) return;
    setPendingDeleteIds((prev) => new Set(prev).add(id));
    if (selectedMessageId === id) setSelectedMessageId(null);
    deleteTimers.current.set(
      id,
      window.setTimeout(() => commitDelete(id), DELETE_COMMIT_MS)
    );
    toast("Message deleted", {
      actionLabel: "Undo",
      onAction: () => undoDelete(id),
      duration: UNDO_WINDOW_MS,
    });
  }

  function undoDelete(id: number) {
    const timer = deleteTimers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    deleteTimers.current.delete(id);
    removePending(id);
  }

  async function commitDelete(id: number) {
    deleteTimers.current.delete(id);
    try {
      await deleteMessage.mutateAsync(id);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Failed to delete message");
    } finally {
      removePending(id);
    }
  }

  return (
    <div className="flex h-full gap-3 p-3">
      <AccountFilterRail
        accounts={accounts ?? []}
        selectedAccountId={selectedAccountId}
        selectedFolderId={selectedFolderId}
        onSelect={selectAccount}
        onSelectFolder={selectFolder}
      />
      <div className="glass-panel w-[380px] shrink-0 overflow-hidden">
        <MessageList
          messages={messages}
          selectedId={selectedMessageId}
          onSelect={setSelectedMessageId}
          onLoadMore={() => messagesQuery.fetchNextPage()}
          hasMore={!!messagesQuery.hasNextPage}
          isLoading={messagesQuery.isLoading}
          onMarkRead={(id, seen) => updateFlags.mutate({ id, seen })}
          onMarkAllRead={() =>
            markAllRead.mutate({ accountId: selectedAccountId, folderId: selectedFolderId })
          }
          markAllPending={markAllRead.isPending}
          onDelete={handleDelete}
        />
      </div>
      <div className="glass-panel flex-1 overflow-hidden">
        <MessageReadingPane summary={selectedSummary} onDelete={handleDelete} />
      </div>
      <ComposeModal />
    </div>
  );
}
