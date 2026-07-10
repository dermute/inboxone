import { useThemeStore, type ThemePreference } from "../store/themeStore";

const OPTIONS: { value: ThemePreference; label: string; icon: string }[] = [
  { value: "light", label: "Light", icon: "☀️" },
  { value: "dark", label: "Dark", icon: "\u{1f319}" },
  { value: "auto", label: "Match system", icon: "\u{1f5a5}️" },
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
          className={`flex-1 rounded-xl py-1 text-center text-xs transition-colors ${
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
