import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { cn, ToastProvider, useSnapChrome } from "../../ui";
import { OfflineBanner } from "../../pwa/Pwa";

const camButtonBase = "inline-flex shrink-0 items-center justify-center bg-cam-chip text-cam-ink hover:bg-cam-chip-hover disabled:opacity-50";
/**
 * Icon buttons on the dark camera screens. `cn` only joins classes, so each size and shape is its own string
 * rather than an override. All clear the 44 px touch target.
 */
export const camButton = `${camButtonBase} size-12 rounded-full`;
export const camButtonSm = `${camButtonBase} size-11 rounded-full`;
export const camButtonSquare = `${camButtonBase} size-12 rounded-2xl`;

/** Pill chip on the dark camera screens (friends count, Recipe, Ate out, recipe link). */
export const camChip =
  "inline-flex min-h-11 items-center gap-2 rounded-full bg-cam-chip px-4 text-sm font-semibold text-cam-ink hover:bg-cam-chip-hover aria-pressed:bg-cam-accent aria-pressed:text-cam-accent-ink";

/**
 * Three equal columns, so the middle item sits in the true centre whatever is on the sides.
 * Used for the top bars and for the shutter and Send rows.
 */
export function ThreeUp({ left, center, right, className }: { left?: ReactNode; center?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-3 items-center", className)}>
      <div className="flex justify-start">{left}</div>
      <div className="flex justify-center">{center}</div>
      <div className="flex justify-end">{right}</div>
    </div>
  );
}

/** Initial in a circle. `tone="you"` is the accent fill used for your own avatar and for friends in lists. */
export function Avatar({ name, className, tone = "plain" }: { name: string; className?: string; tone?: "plain" | "you" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        tone === "you" ? "bg-accent text-accent-contrast" : "bg-cam-chip",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The square frame every photo sits in: the live camera, the shot before sending, and a Snap in the viewer. */
export function PhotoFrame({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("relative aspect-square w-full overflow-hidden rounded-[2.75rem] bg-cam-chip", className)}>{children}</div>;
}

/** Caption over the bottom of the photo, as Locket draws it. */
export const captionPill =
  "absolute bottom-4 left-1/2 max-w-[85%] -translate-x-1/2 truncate rounded-full bg-cam-scrim px-4 py-2.5 text-center text-[15px] font-semibold text-cam-ink";

/**
 * Full-screen dark layout for the camera, the Feed and the Snap viewer: no app header or tab bar.
 * The rest of the app is one tap away in the menu. On a wide screen it stays a phone-width column.
 */
export function SnapShell() {
  useSnapChrome();
  return (
    <ToastProvider>
      <div className="flex h-dvh flex-col bg-cam text-cam-ink [color-scheme:dark]">
        <OfflineBanner />
        <main className="mx-auto flex min-h-0 w-full max-w-[430px] flex-1 flex-col pt-[var(--sat)] pb-[var(--sab)] pl-[var(--sal)] pr-[var(--sar)]">
          <Outlet />
        </main>
      </div>
    </ToastProvider>
  );
}
