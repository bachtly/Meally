import { OFFLINE_CACHES, OFFLINE_STORAGE_KEYS } from "../../pwa/runtimeCaching";

export interface SwDeps {
  sw: ServiceWorkerContainer | undefined;
  /** A new version is installed and waiting. `atStart`: it was already waiting when the page loaded. */
  onUpdate: (apply: () => void, atStart: boolean) => void;
  doc?: Pick<Document, "visibilityState" | "addEventListener">;
}

const wired = new WeakSet<object>();

/** Registers the service worker when the `pwa` flag is on; otherwise unregisters any existing one. */
export async function syncServiceWorker(enabled: boolean, { sw, onUpdate, doc = typeof document === "undefined" ? undefined : document }: SwDeps): Promise<void> {
  if (!sw) return;
  if (!enabled) {
    const regs = await sw.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    return;
  }
  const reg = await sw.register("/sw.js", { scope: "/" });
  const offer = (worker: ServiceWorker | null, atStart: boolean) => {
    if (!worker || !sw.controller) return; // first install is not an "update"
    onUpdate(() => {
      sw.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      worker.postMessage({ type: "SKIP_WAITING" });
    }, atStart);
  };
  offer(reg.waiting, true);
  if (wired.has(reg)) return; // flags refetched: listeners are already in place
  wired.add(reg);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker, false);
    });
  });
  // The browser only checks for a new sw.js on navigation; an installed app can stay open for days. Check on return.
  doc?.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "visible") void reg.update().catch(() => undefined);
  });
}

/** Removes cached recipes and Snaps (call on sign-out so a shared device keeps nothing). */
export async function clearOfflineCaches(): Promise<void> {
  for (const k of OFFLINE_STORAGE_KEYS) {
    try {
      localStorage.removeItem(k);
    } catch {
      // storage blocked: nothing was stored
    }
  }
  if (typeof caches === "undefined") return;
  await Promise.all(OFFLINE_CACHES.map((n) => caches.delete(n).catch(() => false)));
}
