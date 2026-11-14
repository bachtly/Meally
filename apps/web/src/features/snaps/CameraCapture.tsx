import { CameraOff, Images, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { cn } from "../../ui";
import { camButton, camButtonSquare, PhotoFrame, ThreeUp } from "./parts";

type Status = "starting" | "live" | "off";

/** True while the page is visible; the camera is released when the tab or app goes to the background. */
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
 * shutter is always centred. The stream runs only while `active` and the page is visible, and is stopped on
 * shutter, on unmount (route leave) and when the page is hidden.
 */
export function CameraCapture({ active, onPick }: { active: boolean; onPick: (file: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const visible = usePageVisible();
  const stream = useRef<MediaStream | null>(null);
  const run = active && visible;

  const stop = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };

  useEffect(() => {
    if (!run) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    setStatus("starting");
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing, aspectRatio: 1 }, audio: false })
      .then((s) => {
        // The page moved on while the browser asked for permission: release it at once.
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void Promise.resolve(video.current.play?.()).catch(() => undefined);
        }
        setStatus("live");
      })
      .catch(() => !cancelled && setStatus("off"));
    return () => {
      cancelled = true;
      stop();
    };
  }, [run, facing]);

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
    stop();
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
