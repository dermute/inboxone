import { useNotificationStore } from "../store/notificationStore";
import { BellIcon, BellOffIcon } from "./icons";

const SUPPORTED = typeof window !== "undefined" && "Notification" in window && window.isSecureContext;

const disabledClasses =
  "glass-card flex w-full cursor-not-allowed items-center justify-center rounded-2xl py-1 text-xs text-gray-400 dark:text-gray-600";

export default function NotificationToggle() {
  const enabled = useNotificationStore((s) => s.enabled);
  const setEnabled = useNotificationStore((s) => s.setEnabled);

  if (!SUPPORTED) {
    return (
      <button
        disabled
        title="Notifications need a secure context (HTTPS or localhost) - not available on this connection"
        aria-label="Notifications unavailable - needs a secure context (HTTPS or localhost)"
        className={disabledClasses}
      >
        <BellOffIcon />
      </button>
    );
  }

  if (Notification.permission === "denied") {
    return (
      <button
        disabled
        title="Notifications blocked - check your browser's site settings"
        aria-label="Notifications blocked - check your browser's site settings"
        className={disabledClasses}
      >
        <BellOffIcon />
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
      aria-label={enabled ? "Turn off new-mail notifications" : "Turn on new-mail notifications"}
      aria-pressed={enabled}
      className={`glass-card flex w-full items-center justify-center rounded-2xl py-1 text-xs transition-colors ${
        enabled ? "bg-indigo-500/10 dark:bg-indigo-400/15" : "glass-hover"
      }`}
    >
      {enabled ? <BellIcon /> : <BellOffIcon />}
    </button>
  );
}
