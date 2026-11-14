import { render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTheme } from "./ThemeToggle";
import { STATUS_BAR, syncStatusBar, useSnapChrome, watchStatusBar } from "./statusBar";

const meta = () => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

function stubSystemDark(dark: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    get matches() {
      return dark;
    },
    media: "(prefers-color-scheme: dark)",
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", () => mq);
  return (next: boolean) => {
    dark = next;
    listeners.forEach((l) => l());
  };
}

function SnapScreen() {
  useSnapChrome();
  return null;
}

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#fdf9f4">';
  delete document.documentElement.dataset.chrome;
  applyTheme("system");
});
afterEach(() => vi.unstubAllGlobals());

it("uses the light surface, or the dark one when the system is dark", () => {
  const setDark = stubSystemDark(false);
  const stop = watchStatusBar();
  expect(meta()!.content).toBe(STATUS_BAR.light);
  setDark(true);
  expect(meta()!.content).toBe(STATUS_BAR.dark);
  stop();
});

it("follows the theme toggle over the system setting", () => {
  stubSystemDark(false);
  applyTheme("dark");
  expect(meta()!.content).toBe(STATUS_BAR.dark);
  applyTheme("light");
  expect(meta()!.content).toBe(STATUS_BAR.light);
  applyTheme("system");
});

it("turns the status bar camera-dark while a Snap screen is mounted and restores it on leave", () => {
  stubSystemDark(false);
  syncStatusBar();
  const { unmount } = render(<SnapScreen />);
  expect(meta()!.content).toBe(STATUS_BAR.snap);
  expect(document.documentElement.dataset.chrome).toBe("snap");
  applyTheme("light"); // the toggle can't brighten the Snap screens
  expect(meta()!.content).toBe(STATUS_BAR.snap);
  unmount();
  expect(document.documentElement.dataset.chrome).toBeUndefined();
  expect(meta()!.content).toBe(STATUS_BAR.light);
  applyTheme("system");
});

it("restores the dark surface on leave in dark mode", () => {
  stubSystemDark(true);
  const { unmount } = render(<SnapScreen />);
  expect(meta()!.content).toBe(STATUS_BAR.snap);
  unmount();
  expect(meta()!.content).toBe(STATUS_BAR.dark);
});

it("adds the meta when the page has none", () => {
  document.head.innerHTML = "";
  stubSystemDark(false);
  syncStatusBar();
  expect(meta()!.content).toBe(STATUS_BAR.light);
});
