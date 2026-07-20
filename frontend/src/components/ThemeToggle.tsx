import type { ReactNode } from "react";

import { useThemeStore, type ThemePreference } from "../store/themeStore";
import { MonitorIcon, MoonIcon, SunIcon } from "./icons";

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon /> },
  { value: "dark", label: "Dark", icon: <MoonIcon /> },
  { value: "auto", label: "Match system", icon: <MonitorIcon /> },
];

export default function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <div className="glass-card flex gap-0.5 p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setPreference(opt.value)}
          title={opt.label}
          aria-label={opt.label}
          aria-pressed={preference === opt.value}
          className={`flex flex-1 items-center justify-center rounded-xl py-1 text-xs transition-colors ${
            preference === opt.value
              ? "bg-indigo-500/10 dark:bg-indigo-400/15"
              : "glass-hover"
          }`}
        >
          {opt.icon}
        </button>
      ))}
    </div>
  );
}
