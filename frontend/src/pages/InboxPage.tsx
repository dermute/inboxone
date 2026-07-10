import { useMemo } from "react";

import { useAccounts } from "../api/useAccounts";
import { ApiError } from "../api/client";
import { useDeleteMessage, useMarkAllRead, useMessages, useUpdateFlags } from "../api/useMessages";
import AccountFilterRail from "../components/AccountFilterRail";
import ComposeModal from "../components/ComposeModal";
import MessageList from "../components/MessageList";
import MessageReadingPane from "../components/MessageReadingPane";
import { useUiStore } from "../store/uiStore";

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
  const messages = useMemo(
    () => messagesQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [messagesQuery.data]
  );
  const selectedSummary = messages.find((m) => m.id === selectedMessageId) ?? null;

  async function handleDelete(id: number) {
    try {
      await deleteMessage.mutateAsync(id);
      if (selectedMessageId === id) setSelectedMessageId(null);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete message");
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
