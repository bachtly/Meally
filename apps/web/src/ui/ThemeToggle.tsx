import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { cn } from "./cn";
import { syncStatusBar } from "./statusBar";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "meally-theme";

/** Dark is the default (#98); "system" is a choice people make in Settings, so it is stored like the others. */
export const DEFAULT_THEME: ThemeChoice = "dark";

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // storage blocked: fall back to the default
  }
  return DEFAULT_THEME;
}

/** Shows `choice`, and remembers it unless `save` is false (startup, so the default can change later). */
export function applyTheme(choice: ThemeChoice, save = true) {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
  syncStatusBar();
  if (!save) return;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: the choice lasts for this page only
  }
}

const options = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-md border border-line bg-raised p-0.5">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => {
            setChoice(value);
            applyTheme(value);
          }}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-sm px-3 text-sm",
            choice === value ? "bg-accent text-accent-contrast" : "text-ink hover:bg-sunken",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
