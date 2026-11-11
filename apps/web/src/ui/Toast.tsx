import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "danger";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
  action?: ToastAction;
}
export interface ToastAction {
  label: string;
  onClick: () => void;
}
const ToastContext = createContext<(message: string, tone?: Tone, action?: ToastAction) => void>(() => {});
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: Tone = "info", action?: ToastAction) => {
    const id = nextId++;
    setItems((s) => [...s, { id, message, tone, action }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5rem+var(--sab))] z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-[calc(1.5rem+var(--sab))]"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto rounded-md border border-line bg-raised px-4 py-3 text-sm shadow-md",
              t.tone === "success" && "text-success",
              t.tone === "danger" && "text-danger",
              t.tone === "info" && "text-ink",
            )}
          >
            {t.message}
            {t.action && (
              <button type="button" className="ml-3 min-h-11 font-medium text-accent underline" onClick={t.action.onClick}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
