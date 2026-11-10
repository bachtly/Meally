import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { cn } from "./cn";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "meally-theme";

export function readTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    // storage blocked: fall back to system
  }
  return "system";
}

export function applyTheme(choice: ThemeChoice) {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
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
            "inline-flex min-h-10 items-center gap-1.5 rounded-sm px-3 text-sm",
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
