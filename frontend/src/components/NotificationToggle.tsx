import { useNotificationStore } from "../store/notificationStore";

const SUPPORTED = typeof window !== "undefined" && "Notification" in window && window.isSecureContext;

const disabledClasses =
  "glass-card w-full cursor-not-allowed rounded-2xl py-1 text-center text-xs text-gray-400 dark:text-gray-600";

export default function NotificationToggle() {
  const enabled = useNotificationStore((s) => s.enabled);
  const setEnabled = useNotificationStore((s) => s.setEnabled);

  if (!SUPPORTED) {
    return (
      <button
        disabled
        title="Notifications need a secure context (HTTPS or localhost) - not available on this connection"
        className={disabledClasses}
      >
        🔕
      </button>
    );
  }

  if (Notification.permission === "denied") {
    return (
      <button disabled title="Notifications blocked - check your browser's site settings" className={disabledClasses}>
        🔕
      </button>
    );
  }

  async function handleClick() {
    if (enabled) {
      setEnabled(false);
      return;
    }
    if (Notification.permission === "granted") {
      setEnabled(true);
      return;
    }
    const result = await Notification.requestPermission();
    if (result === "granted") setEnabled(true);
  }

  return (
    <button
      onClick={handleClick}
      title={enabled ? "New-mail notifications on - click to turn off" : "Turn on new-mail notifications"}
      aria-pressed={enabled}
      className={`glass-card w-full rounded-2xl py-1 text-center text-xs transition-colors ${
        enabled ? "bg-indigo-500/10 dark:bg-indigo-400/15" : "glass-hover"
      }`}
    >
      {enabled ? "🔔" : "🔕"}
    </button>
  );
}
