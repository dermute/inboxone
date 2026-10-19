import { usePwaStore } from "../store/pwaStore";
import { toast } from "../store/toastStore";

export default function InstallAppButton() {
  const installPrompt = usePwaStore((s) => s.installPrompt);
  const installed = usePwaStore((s) => s.installed);
  const install = usePwaStore((s) => s.install);

  if (!installPrompt || installed) return null;

  async function handleClick() {
    try {
      await install();
    } catch {
      toast("Installation could not start. Try installing InboxOne from your browser's menu.");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="glass-hover block w-full rounded-2xl px-3 py-2 text-left text-sm text-gray-600 dark:text-gray-300"
    >
      Install InboxOne
    </button>
  );
}
