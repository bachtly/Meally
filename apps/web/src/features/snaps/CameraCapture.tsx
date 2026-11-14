import { CameraOff, Images, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { cn } from "../../ui";
import { cameraPermission, HIDDEN_MS, KEEP_MS, openCamera, releaseCamera, type Facing } from "./camera";
import { camButton, camButtonSquare, PhotoFrame, ThreeUp } from "./parts";

type Status = "starting" | "live" | "off";

/** True while the page is visible; the camera is let go when the tab or app goes to the background. */
function usePageVisible() {
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

const fileLabel = "cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus-ring)]";

/**
 * Square live camera with the shutter row under it: photo picker, shutter, flip, in three equal columns so the
 * shutter is always centred. The stream is shared (`camera.ts`) so coming back to the camera reuses it instead of
 * asking the browser again: it keeps running under the menu and friends sheets, is kept for a while after the shot
 * or a trip to the Feed, and for a shorter while when the page is hidden. `SnapShell` stops it when you leave the
 * Snap screens.
 */
export function CameraCapture({ onPick }: { onPick: (file: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [facing, setFacing] = useState<Facing>("environment");
  /** undefined until asked; "unknown" where the browser can't tell (then we just call getUserMedia). */
  const [permission, setPermission] = useState<PermissionState | "unknown">();
  const visible = usePageVisible();
  const known = permission !== undefined;
  const denied = permission === "denied";

  // Where the browser tells us, a denied camera shows "Camera is off" without a call, and a later grant starts it.
  useEffect(() => {
    let live = true;
    let perm: PermissionStatus | null = null;
    const on = () => perm && setPermission(perm.state);
    void cameraPermission().then((p) => {
      if (!live) return;
      if (!p) return setPermission("unknown");
      perm = p;
      on();
      p.addEventListener?.("change", on);
    });
    return () => {
      live = false;
      perm?.removeEventListener?.("change", on);
    };
  }, []);

  useEffect(() => {
    if (!visible || !known) return;
    if (!navigator.mediaDevices?.getUserMedia || denied) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    const v = video.current;
    setStatus("starting");
    openCamera(facing)
      .then((s) => {
        if (cancelled) return;
        if (v) {
          v.srcObject = s;
          void Promise.resolve(v.play?.()).catch(() => undefined);
        }
        setStatus("live");
      })
      .catch(() => !cancelled && setStatus("off"));
    return () => {
      cancelled = true;
      if (v) v.srcObject = null;
      releaseCamera(document.visibilityState === "hidden" ? HIDDEN_MS : KEEP_MS);
    };
  }, [visible, known, facing, denied]);

  /** Crops the frame to the centred square the viewfinder shows, so the Snap matches what you saw. */
  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const side = Math.min(v.videoWidth, v.videoHeight);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, (v.videoWidth - side) / 2, (v.videoHeight - side) / 2, side, side, 0, 0, side, side);
    canvas.toBlob(
      (blob) => {
        if (blob) onPick(new File([blob], "snap.jpg", { type: "image/jpeg" }));
        else setStatus("off");
      },
      "image/jpeg",
      0.9,
    );
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) onPick(f);
  }

  return (
    <div className="flex flex-col gap-9">
      <PhotoFrame>
        <video
          ref={video}
          playsInline
          muted
          aria-label="Camera preview"
          className={cn("size-full object-cover", facing === "user" && "-scale-x-100")}
          hidden={status !== "live"}
        />
        {status === "starting" && (
          <div role="status" className="absolute inset-0 grid place-items-center text-sm text-cam-muted">
            Starting camera…
          </div>
        )}
        {status === "off" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <CameraOff className="size-8 text-cam-muted" aria-hidden />
            <p className="font-semibold">Camera is off</p>
            <p className="text-sm text-cam-muted">Allow the camera in your browser, or pick a photo.</p>
            <label className={cn("inline-flex min-h-11 items-center rounded-full bg-cam-accent px-5 font-semibold text-cam-accent-ink", fileLabel)}>
              Pick from your photos
              <input type="file" accept="image/*" className="sr-only" onChange={onFile} />
            </label>
          </div>
        )}
      </PhotoFrame>
      <ThreeUp
        className="px-3"
        left={
          <label className={cn(camButtonSquare, fileLabel)}>
            <Images className="size-6" aria-hidden />
            <input type="file" accept="image/*" aria-label="Choose photo" className="sr-only" onChange={onFile} />
          </label>
        }
        center={
          <button
            type="button"
            aria-label="Take photo"
            disabled={status !== "live"}
            onClick={shoot}
            className="size-22 rounded-full border-4 border-cam-accent p-1.5 disabled:opacity-50"
          >
            <span className="block size-full rounded-full bg-cam-ink" />
          </button>
        }
        right={
          <button
            type="button"
            aria-label="Flip camera"
            disabled={status === "off"}
            className={camButton}
            onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
          >
            <RefreshCcw className="size-6" aria-hidden />
          </button>
        }
      />
    </div>
  );
}
