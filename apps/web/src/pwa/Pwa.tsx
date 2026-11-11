import { Download, Smartphone, WifiOff } from "lucide-react";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFeature, useFeaturesState } from "../features/features/FeaturesProvider";
import { Button } from "../ui";

const CARD_KEY = "meally.install-card.dismissed";
function readDismissed() {
  try {
    return localStorage.getItem(CARD_KEY) === "1";
  } catch {
    return false;
  }
}
import { syncServiceWorker } from "./register";
import { createUpdateScheduler, type UpdateScheduler } from "./updates";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
interface PwaState {
  online: boolean;
  canInstall: boolean;
  install: () => void;
  isIos: boolean;
  installed: boolean;
}
const PwaContext = createContext<PwaState>({ online: true, canInstall: false, install: () => {}, isIos: false, installed: false });
export const usePwa = () => useContext(PwaContext);

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/** Owns SW registration (flag-gated), the install prompt, and the update prompt. Render inside FeaturesProvider. */
export function PwaProvider({ children }: { children: ReactNode }) {
  const enabled = useFeature("pwa");
  const { features } = useFeaturesState();
  const online = useOnline();
  const [apply, setApply] = useState<(() => void) | null>(null);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const scheduler = useRef<UpdateScheduler | null>(null);
  const pendingApply = useRef<() => void>(() => {});

  // Updates apply on their own while the app is hidden or just opened; the toast is only a fallback (updates.ts).
  useEffect(() => {
    const s = createUpdateScheduler({ doc: document, win: window, onFallback: () => setApply(() => pendingApply.current) });
    scheduler.current = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    if (!features) return; // flags unknown (loading or offline): leave any existing SW alone
    void syncServiceWorker(enabled, {
      sw: typeof navigator !== "undefined" ? navigator.serviceWorker : undefined,
      onUpdate: (fn, atStart) => {
        pendingApply.current = fn;
        scheduler.current?.offer(fn, atStart);
      },
    }).catch(() => undefined);
  }, [enabled, features]);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const standalone = typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  const state: PwaState = {
    online,
    canInstall: enabled && !!prompt,
    install: () => {
      void prompt?.prompt();
      setPrompt(null);
    },
    isIos: enabled && isIos,
    installed: installed || !!standalone,
  };
  return (
    <PwaContext.Provider value={state}>
      {children}
      {apply && <UpdateToast onReload={apply} />}
    </PwaContext.Provider>
  );
}

export function OfflineBanner() {
  const { online } = usePwa();
  if (online) return null;
  return (
    <div role="status" className="print:hidden flex items-center justify-center gap-2 bg-sunken px-4 py-2 text-sm text-ink">
      <WifiOff className="size-4" aria-hidden />
      You're offline. Recently viewed recipes still work.
    </div>
  );
}

export function UpdateToast({ onReload }: { onReload: () => void }) {
  return (
    <div role="status" className="print:hidden fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm items-center justify-between gap-3 rounded-lg border border-line bg-raised p-3 shadow-lg lg:bottom-6">
      <span className="text-sm">A new version is ready</span>
      <Button size="sm" onClick={onReload}>
        Reload
      </Button>
    </div>
  );
}

/** "Install app" entry for the More page. Shows the native prompt, or iOS Add-to-Home-Screen steps. */
export function InstallItem() {
  const { canInstall, install, isIos, installed } = usePwa();
  if (installed || (!canInstall && !isIos)) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Install app</h2>
      {canInstall ? (
        <Button variant="secondary" className="self-start" onClick={install}>
          <Download className="size-4" aria-hidden />
          Install Meally
        </Button>
      ) : (
        <p className="text-sm text-muted">On iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".</p>
      )}
    </section>
  );
}

/**
 * A one-time "add to home screen" card, shown after a newcomer's first save (web.dev: promote after a completed
 * journey, let people dismiss it, and remember that). Hidden when installed, when install isn't possible, or once dismissed.
 */
export function InstallCard() {
  const { canInstall, install, isIos, installed } = usePwa();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (installed || dismissed || (!canInstall && !isIos)) return null;
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(CARD_KEY, "1");
    } catch {
      // storage blocked: it just comes back next time
    }
  };
  return (
    <aside aria-label="Install Meally" className="print:hidden flex items-start gap-3 rounded-lg border border-line bg-raised p-4 shadow-sm">
      <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-medium">Add Meally to your home screen</p>
        <p className="text-sm text-muted">
          {canInstall
            ? "Open your recipes like an app, and read recent ones offline."
            : 'On iPhone or iPad: tap the Share button in Safari, then "Add to Home Screen".'}
        </p>
        <div className="flex flex-wrap gap-2">
          {canInstall && (
            <Button
              size="sm"
              onClick={() => {
                install();
                dismiss();
              }}
            >
              <Download className="size-4" aria-hidden />
              Install
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Not now
          </Button>
        </div>
      </div>
    </aside>
  );
}
