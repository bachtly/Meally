import { useEffect, useState } from "react";

export type WakeState = "on" | "unsupported" | "pending";

/** Keeps the screen awake while mounted. Re-acquires when the tab becomes visible again. */
export function useWakeLock(): WakeState {
  const [state, setState] = useState<WakeState>(() => (typeof navigator !== "undefined" && "wakeLock" in navigator ? "pending" : "unsupported"));
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let live = true;
    const acquire = async () => {
      try {
        const s = await navigator.wakeLock.request("screen");
        if (!live) return void s.release().catch(() => {});
        sentinel = s;
        setState("on");
        s.addEventListener("release", () => live && setState("pending"));
      } catch {
        if (live) setState("unsupported"); // denied, or blocked (some iOS home-screen apps)
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, []);
  return state;
}
