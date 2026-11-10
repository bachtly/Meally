import { OFFLINE_CACHES } from "../../pwa/runtimeCaching";

export interface SwDeps {
  sw: ServiceWorkerContainer | undefined;
  onUpdate: (apply: () => void) => void;
}

/** Registers the service worker when the `pwa` flag is on; otherwise unregisters any existing one. */
export async function syncServiceWorker(enabled: boolean, { sw, onUpdate }: SwDeps): Promise<void> {
  if (!sw) return;
  if (!enabled) {
    const regs = await sw.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    return;
  }
  const reg = await sw.register("/sw.js", { scope: "/" });
  const offer = (worker: ServiceWorker | null) => {
    if (!worker || !sw.controller) return; // first install is not an "update"
    onUpdate(() => {
      sw.addEventListener("controllerchange", () => window.location.reload(), { once: true });
      worker.postMessage({ type: "SKIP_WAITING" });
    });
  };
  offer(reg.waiting);
  reg.addEventListener("updatefound", () => {
    const worker = reg.installing;
    worker?.addEventListener("statechange", () => {
      if (worker.state === "installed") offer(worker);
    });
  });
}

/** Removes cached recipe data (call on sign-out so a shared device keeps nothing). */
export async function clearOfflineCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  await Promise.all(OFFLINE_CACHES.map((n) => caches.delete(n).catch(() => false)));
}
