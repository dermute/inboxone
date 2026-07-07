import { useMemo } from "react";

import { useAccounts } from "../api/useAccounts";
import { useMessages } from "../api/useMessages";
import AccountFilterRail from "../components/AccountFilterRail";
import ComposeModal from "../components/ComposeModal";
import MessageList from "../components/MessageList";
import MessageReadingPane from "../components/MessageReadingPane";
import { useUiStore } from "../store/uiStore";

export default function InboxPage() {
  const { data: accounts } = useAccounts();
  const selectedAccountId = useUiStore((s) => s.selectedAccountId);
  const setSelectedAccountId = useUiStore((s) => s.setSelectedAccountId);
  const selectedMessageId = useUiStore((s) => s.selectedMessageId);
  const setSelectedMessageId = useUiStore((s) => s.setSelectedMessageId);

  const messagesQuery = useMessages({ accountId: selectedAccountId });
  const messages = useMemo(
    () => messagesQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [messagesQuery.data]
  );
  const selectedSummary = messages.find((m) => m.id === selectedMessageId) ?? null;

  return (
    <div className="flex h-screen">
      <AccountFilterRail
        accounts={accounts ?? []}
        selectedAccountId={selectedAccountId}
        onSelect={setSelectedAccountId}
      />
      <div className="w-[380px] shrink-0 border-r border-gray-100 dark:border-neutral-800">
        <MessageList
          messages={messages}
          selectedId={selectedMessageId}
          onSelect={setSelectedMessageId}
          onLoadMore={() => messagesQuery.fetchNextPage()}
          hasMore={!!messagesQuery.hasNextPage}
          isLoading={messagesQuery.isLoading}
        />
      </div>
      <div className="flex-1">
        <MessageReadingPane summary={selectedSummary} />
      </div>
      <ComposeModal />
    </div>
  );
}
