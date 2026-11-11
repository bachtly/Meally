import { useEffect } from "react";

/**
 * Applies a downloaded app update without asking: while the app is hidden (switched away, phone locked), or right at
 * start before the user has touched anything. Screens with work in progress (unsaved edits, cook mode) hold updates
 * off. If the app stays on screen for `fallbackMs` with an update waiting, the caller shows the "new version" toast.
 */

let holds = 0;
const holdListeners = new Set<() => void>();

/** Holds updates while `active` (e.g. the editor has unsaved changes). Release re-checks whether to apply. */
export function useHoldUpdates(active: boolean) {
  useEffect(() => {
    if (!active) return;
    holds += 1;
    return () => {
      holds -= 1;
      for (const l of holdListeners) l();
    };
  }, [active]);
}

export const updatesHeld = () => holds > 0;

export const FALLBACK_MS = 30 * 60 * 1000;

export interface SchedulerDeps {
  doc: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Shows the toast once the update has waited `fallbackMs` on screen. */
  onFallback: () => void;
  fallbackMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface UpdateScheduler {
  /** A new version is waiting; `atStart` when it was already waiting as the page loaded. */
  offer(apply: () => void, atStart: boolean): void;
  dispose(): void;
}

export function createUpdateScheduler(deps: SchedulerDeps): UpdateScheduler {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const fallbackMs = deps.fallbackMs ?? FALLBACK_MS;
  let pending: (() => void) | null = null;
  let applied = false;
  let touched = false;
  let timer: unknown = null;

  const hidden = () => deps.doc.visibilityState === "hidden";
  const run = () => {
    if (!pending || applied || updatesHeld()) return false;
    applied = true;
    if (timer !== null) clearTimer(timer);
    pending();
    return true;
  };
  const onVisibility = () => {
    if (hidden()) run();
  };
  const onRelease = () => {
    if (hidden()) run();
  };
  const onTouch = () => {
    touched = true;
  };

  deps.doc.addEventListener("visibilitychange", onVisibility);
  deps.win.addEventListener("pointerdown", onTouch, { capture: true });
  deps.win.addEventListener("keydown", onTouch, { capture: true });
  holdListeners.add(onRelease);

  return {
    offer(apply, atStart) {
      if (applied) return;
      pending = apply;
      // Hidden now, or just opened and not used yet: nothing on screen to lose.
      if ((hidden() || (atStart && !touched)) && run()) return;
      if (timer === null) {
        timer = setTimer(() => {
          if (!applied && pending) deps.onFallback();
        }, fallbackMs);
      }
    },
    dispose() {
      if (timer !== null) clearTimer(timer);
      deps.doc.removeEventListener("visibilitychange", onVisibility);
      deps.win.removeEventListener("pointerdown", onTouch, { capture: true });
      deps.win.removeEventListener("keydown", onTouch, { capture: true });
      holdListeners.delete(onRelease);
    },
  };
}
