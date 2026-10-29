import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { type Connections, useLiveSync } from "../api/liveSync";
import { useActivityStore, visibleWork } from "../store/activityStore";
import { useTriggerSync } from "../api/useSync";

const colors: Record<string, string> = { green: "bg-green-500", yellow: "bg-yellow-500",
  red: "bg-red-500", neutral: "bg-gray-400" };
function date(value?: string) {
  if (!value) return "Never";
  // SQLite stores UTC timestamps without an offset.
  return new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + "Z").toLocaleString();
}
export default function ConnectionStatus({ showLabel = false }: { showLabel?: boolean }) {
  const local = useActivityStore((s) => s.local);
  const server = useActivityStore((s) => s.server);
  const work = visibleWork(local, server);
  const connected = useLiveSync((s) => s.connected);
  const query = useQuery({ queryKey: ["connections"],
    queryFn: () => api.get<Connections>("/api/sync/connections") });
  const refresh = useTriggerSync();
  const retry = useMutation({ mutationFn: (id: number) =>
    api.post(`/api/sync/retry?account_id=${id}`), onSuccess: () => query.refetch() });
  const health = query.data?.health === "neutral" ? "neutral" :
    query.data?.health === "red" ? "red" : !connected ? "yellow" : query.data?.health ?? "yellow";
  const label = health === "neutral" ? "No active accounts" : health === "green" ? "Connected" :
    health === "red" ? "Connection error" : "Connecting or polling";
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button className="glass-hover flex items-center gap-2 rounded-full p-2 text-xs"
          title={label} aria-label={`Connection status: ${label}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${colors[health]}`} />
          <span className={showLabel ? "" : "sr-only"}>{label}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="glass-panel fixed left-1/2 top-1/2 z-50 max-h-[85dvh] w-[min(95vw,40rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-6">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="text-lg font-semibold">Connection status</Dialog.Title>
            <Dialog.Close className="glass-button">Close</Dialog.Close>
          </div>
          <Dialog.Description className="my-3 text-sm">
            {label}. Other folders refresh every {query.data?.refresh_seconds === 60 ? "60 seconds" : "15 minutes"}.
          </Dialog.Description>
          {!connected && <p className="mb-3 text-sm text-yellow-600">Live updates disconnected. Mail checks every 60 seconds; activity checks every 2 seconds while visible.</p>}
          {work.length > 0 && <section aria-label="Ongoing activity" className="glass-card mb-3 p-3 text-sm">
            <h2 className="mb-2 font-semibold">Ongoing activity</h2>
            <ul className="space-y-1">{work.map((item) => <li key={item.id}>
              {item.label}{item.state === "queued" ? " (queued)" : ""}
            </li>)}</ul>
          </section>}
          {query.isError && <p role="alert">Could not load connection details.</p>}
          {query.data?.accounts.map((account) => (
            <section key={account.account_id} className="glass-card mb-3 space-y-2 p-3 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: account.color }} />
                <h2 className="flex-1 font-semibold">{account.name} · {account.health}</h2>
                <button className="glass-button" disabled={retry.isPending}
                  onClick={() => retry.mutate(account.account_id)}>Retry</button>
              </div>
              {account.error && <p>{account.error} · {date(account.error_at)}</p>}
              {account.folders.map((folder) => (
                <div key={folder.folder_id} className="glass-divider border-t pt-2">
                  <p>{folder.name} · {folder.state} · {folder.mode === "idle" ? "IMAP IDLE" : folder.mode === "polling" ? "60-second polling fallback" : "Scheduled refresh"}</p>
                  <p className="text-xs">Last successful sync: {date(folder.last_success)}</p>
                  {(folder.sync_error || folder.error) && <p className="text-xs text-red-600">{folder.sync_error || folder.error} · {date(folder.sync_error_at || folder.error_at)}</p>}
                  {folder.next_retry && <p className="text-xs">Next connection attempt: {date(folder.next_retry)}</p>}
                </div>
              ))}
            </section>
          ))}
          {(retry.isError || refresh.isError) && <p role="alert">Could not request refresh. Please try again.</p>}
          <button className="glass-button-primary" disabled={refresh.isPending}
            onClick={() => refresh.mutate(undefined)}>Refresh all</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
