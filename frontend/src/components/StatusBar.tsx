import { useActivityStore, visibleWork } from "../store/activityStore";
import ConnectionStatus from "./ConnectionStatus";

export default function StatusBar() {
  const local = useActivityStore((s) => s.local);
  const server = useActivityStore((s) => s.server);
  const work = visibleWork(local, server);
  return (
    <footer aria-label="Application status" className="glass-divider flex shrink-0 items-center gap-2 border-t px-3 pt-1 text-xs"
      style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom))" }}>
      <ConnectionStatus showLabel={work.length === 0} />
      <div role="status" aria-live="polite" aria-atomic="true" className="flex min-w-0 flex-1 items-center gap-2">
        {work.length > 0 && <>
          <span aria-hidden="true" className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
          <span className="truncate">{work[0].label}</span>
          {work.length > 1 && <span className="shrink-0">+{work.length - 1} more</span>}
        </>}
      </div>
    </footer>
  );
}
