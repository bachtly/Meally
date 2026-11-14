/**
 * One camera stream shared by the Snap screens. iOS, above all in a home-screen app, can ask for the camera again
 * on every `getUserMedia` call, so we call it as rarely as we can: the stream is reused while it is live, and when
 * the camera leaves the screen it is stopped after a short delay rather than at once. Policy in
 * docs/design/features/snaps.md#camera-permission.
 */

export type Facing = "environment" | "user";

/** Off the camera but still on the Snap screens (shot taken, Feed, viewer): keep the stream this long. */
export const KEEP_MS = 60_000;
/** Page hidden (app switched, screen locked): keep the stream this long. */
export const HIDDEN_MS = 15_000;

let current: { stream: MediaStream; facing: Facing } | null = null;
let pending: { promise: Promise<MediaStream>; facing: Facing } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function cancelTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

const isLive = (s: MediaStream) => s.getTracks().every((t) => t.readyState !== "ended");

/** The live stream for `facing`, reusing the open one when it still runs. Asks the browser only when it must. */
export function openCamera(facing: Facing): Promise<MediaStream> {
  cancelTimer();
  if (current && current.facing === facing && isLive(current.stream)) return Promise.resolve(current.stream);
  if (pending && pending.facing === facing) return pending.promise;
  stopCamera();
  const promise = navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, aspectRatio: 1 }, audio: false }).then(
    (stream) => {
      // Superseded (flip, or stopped) while the browser asked: release it at once.
      if (pending?.promise !== promise) {
        stream.getTracks().forEach((t) => t.stop());
        throw new Error("superseded");
      }
      pending = null;
      current = { stream, facing };
      return stream;
    },
    (e: unknown) => {
      if (pending?.promise === promise) pending = null;
      throw e;
    },
  );
  pending = { promise, facing };
  return promise;
}

/** Stops the stream after `ms` unless it is opened again first. */
export function releaseCamera(ms: number) {
  cancelTimer();
  if (!current && !pending) return;
  timer = setTimeout(stopCamera, ms);
}

/** Stops the stream now: leaving the Snap screens. */
export function stopCamera() {
  cancelTimer();
  pending = null;
  current?.stream.getTracks().forEach((t) => t.stop());
  current = null;
}

/** The camera permission status where the browser exposes it (Chrome; Safari 16+), else null. Never prompts. */
export async function cameraPermission(): Promise<PermissionStatus | null> {
  try {
    return (await navigator.permissions?.query({ name: "camera" as PermissionName })) ?? null;
  } catch {
    return null;
  }
}
