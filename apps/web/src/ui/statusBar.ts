import { useEffect } from "react";

/**
 * Status bar colour. Installed apps on iOS 15.4+ and Android, and Android Chrome tabs, tint the status bar from
 * <meta name="theme-color">; Safari 26 tabs ignore it and sample the page background, which theme.css darkens via
 * [data-chrome="snap"]. We keep iOS's default status-bar style: black-translucent would put white icons over the
 * cream pages. See docs/design/features/snaps.md#status-bar.
 *
 * theme-color needs a plain colour, so these are the sRGB hex values of the theme.css tokens.
 */
export const STATUS_BAR = {
  light: "#fdf9f4", // --surface, light
  dark: "#13120c", // --surface, dark
  snap: "#0a0906", // --cam-bg (dark in both themes)
} as const;

const DARK_QUERY = "(prefers-color-scheme: dark)";

function prefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

/** The colour the status bar should have right now, from the chrome mark and the theme (data-theme or system). */
export function statusBarColor(root: HTMLElement = document.documentElement): string {
  if (root.dataset.chrome === "snap") return STATUS_BAR.snap;
  const theme = root.dataset.theme;
  const dark = theme === "dark" || (theme !== "light" && prefersDark());
  return dark ? STATUS_BAR.dark : STATUS_BAR.light;
}

/** Writes the current colour to the theme-color meta, adding the meta if index.html didn't. */
export function syncStatusBar(): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = statusBarColor();
}

/** Keeps the status bar in step with the system light/dark setting. Call once at startup. */
export function watchStatusBar(): () => void {
  syncStatusBar();
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener?.("change", syncStatusBar);
  return () => mq.removeEventListener?.("change", syncStatusBar);
}

/** While mounted, the page chrome (status bar, html background) is the dark camera colour; restored on leave. */
export function useSnapChrome(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.chrome = "snap";
    syncStatusBar();
    return () => {
      delete root.dataset.chrome;
      syncStatusBar();
    };
  }, []);
}
