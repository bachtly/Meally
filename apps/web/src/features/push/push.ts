import { useCallback, useEffect, useState } from "react";
import type { PushKeyResponse } from "@meally/shared";
import { api, ApiRequestError, postJson } from "../../lib/api";

/** The id the server gave this device's subscription, so turning off (or signing out) can delete it. */
const STORE = "meally:push-subscription";

export type PushStatus = "loading" | "unsupported" | "ios-install" | "unconfigured" | "denied" | "off" | "on";

export interface PushEnv {
  nav: Navigator;
  win: Window & typeof globalThis;
}
const realEnv = (): PushEnv => ({ nav: navigator, win: window });

const isIos = (nav: Navigator) => /iPad|iPhone|iPod/.test(nav.userAgent) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
const isStandalone = (env: PushEnv) =>
  env.win.matchMedia?.("(display-mode: standalone)").matches === true || (env.nav as Navigator & { standalone?: boolean }).standalone === true;

/** What this browser can do before asking anything. iOS only offers push to an app added to the Home Screen. */
export function pushSupport(env: PushEnv = realEnv()): "unsupported" | "ios-install" | "ok" {
  if (isIos(env.nav) && !isStandalone(env)) return "ios-install";
  if (!("serviceWorker" in env.nav) || !("PushManager" in env.win) || !("Notification" in env.win)) return "unsupported";
  return "ok";
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (b64url.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

const storedId = () => {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
};
const storeId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(STORE, id);
    else localStorage.removeItem(STORE);
  } catch {
    /* storage blocked: turning off still unsubscribes in the browser */
  }
};

/**
 * Unsubscribes this browser and deletes the server's copy. Called by the switch and on sign-out, so a shared
 * device stops getting the last person's notifications. Never throws.
 */
export async function forgetPushOnThisDevice(env: PushEnv = realEnv()): Promise<void> {
  try {
    const reg = "serviceWorker" in env.nav ? await env.nav.serviceWorker.getRegistration() : undefined;
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* nothing to undo */
  }
  const id = storedId();
  storeId(null);
  if (id) await api<void>(`/push/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);
}

/** State and actions for the Settings switch. The permission prompt only ever comes from `turnOn` (a tap). */
export function usePushSwitch(env: PushEnv = realEnv()) {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const support = pushSupport(env);
      if (support !== "ok") return live && setStatus(support);
      if (env.win.Notification.permission === "denied") return live && setStatus("denied");
      const reg = await env.nav.serviceWorker.getRegistration().catch(() => undefined);
      const sub = await reg?.pushManager.getSubscription().catch(() => null);
      if (live) setStatus(sub && storedId() ? "on" : "off");
    })();
    return () => {
      live = false;
    };
    // The environment is fixed for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOn = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const permission = await env.win.Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      let key: PushKeyResponse;
      try {
        key = await api<PushKeyResponse>("/push/key");
      } catch (e) {
        if (e instanceof ApiRequestError && (e.status === 503 || e.status === 404)) return setStatus("unconfigured");
        throw e;
      }
      const reg = await env.nav.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key.publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const { id } = await postJson<{ id: string }>("/push/subscriptions", { endpoint: json.endpoint, keys: json.keys });
      storeId(id);
      setStatus("on");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Couldn't turn on notifications. Try again.");
    } finally {
      setBusy(false);
    }
  }, [env]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    setError(null);
    setStatus("off");
    await forgetPushOnThisDevice(env);
    setBusy(false);
  }, [env]);

  return { status, busy, error, turnOn, turnOff };
}
