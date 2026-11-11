import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createUpdateScheduler, useHoldUpdates } from "./updates";

function env(visibility: DocumentVisibilityState = "visible") {
  const doc = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
  doc.visibilityState = visibility;
  const win = new EventTarget();
  const timers: (() => void)[] = [];
  const onFallback = vi.fn();
  const s = createUpdateScheduler({
    doc: doc as unknown as Document,
    win: win as unknown as Window,
    onFallback,
    setTimer: (fn) => timers.push(fn),
    clearTimer: () => {},
  });
  const setVisibility = (v: DocumentVisibilityState) => {
    doc.visibilityState = v;
    doc.dispatchEvent(new Event("visibilitychange"));
  };
  return { s, win, onFallback, timers, setVisibility };
}

function Hold({ on }: { on: boolean }) {
  useHoldUpdates(on);
  return null;
}

let dispose: (() => void) | undefined;
afterEach(() => dispose?.());

describe("background updates", () => {
  it("applies straight away at start when the app hasn't been touched", () => {
    const e = env();
    dispose = e.s.dispose;
    const apply = vi.fn();
    e.s.offer(apply, true);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("waits while visible after the user has started using the app, then applies when hidden", () => {
    const e = env();
    dispose = e.s.dispose;
    e.win.dispatchEvent(new Event("pointerdown"));
    const apply = vi.fn();
    e.s.offer(apply, true);
    expect(apply).not.toHaveBeenCalled();
    e.setVisibility("hidden");
    expect(apply).toHaveBeenCalledTimes(1);
    e.setVisibility("visible");
    e.setVisibility("hidden");
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("does not apply an update found mid-session until the app is hidden", () => {
    const e = env();
    dispose = e.s.dispose;
    const apply = vi.fn();
    e.s.offer(apply, false);
    expect(apply).not.toHaveBeenCalled();
    e.setVisibility("hidden");
    expect(apply).toHaveBeenCalled();
  });

  it("applies at once when the update arrives while hidden", () => {
    const e = env("hidden");
    dispose = e.s.dispose;
    const apply = vi.fn();
    e.s.offer(apply, false);
    expect(apply).toHaveBeenCalled();
  });

  it("holds off while a screen has work in progress, and applies once it is released while hidden", () => {
    const e = env();
    dispose = e.s.dispose;
    const view = render(<Hold on />);
    const apply = vi.fn();
    e.s.offer(apply, true);
    e.setVisibility("hidden");
    expect(apply).not.toHaveBeenCalled();
    view.rerender(<Hold on={false} />);
    expect(apply).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it("shows the toast only after the fallback delay, and not once applied", () => {
    const e = env();
    dispose = e.s.dispose;
    e.s.offer(vi.fn(), false);
    expect(e.onFallback).not.toHaveBeenCalled();
    e.timers[0]!();
    expect(e.onFallback).toHaveBeenCalledTimes(1);

    const f = env();
    const apply = vi.fn();
    f.s.offer(apply, false);
    f.setVisibility("hidden");
    f.timers[0]!();
    expect(f.onFallback).not.toHaveBeenCalled();
    f.s.dispose();
  });
});
