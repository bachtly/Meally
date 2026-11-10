import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { cn } from "./cn";

type Tone = "info" | "success" | "danger";
interface ToastItem {
  id: number;
  message: string;
  tone: Tone;
}
const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => {});
let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((message: string, tone: Tone = "info") => {
    const id = nextId++;
    setItems((s) => [...s, { id, message, tone }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex flex-col items-center gap-2 px-4 lg:bottom-6"
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
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
