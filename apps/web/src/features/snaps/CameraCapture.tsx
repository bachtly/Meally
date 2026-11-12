import { Camera, FlipHorizontal2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Button, IconButton } from "../../ui";

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

/**
 * Live camera with a "Choose photo" fallback. The stream runs only while `active` and the page is visible, and is
 * stopped on shutter, on unmount (route leave) and when the page is hidden.
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
      .getUserMedia({ video: { facingMode: facing }, audio: false })
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

  function shoot() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
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
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-ink">
        <video ref={video} playsInline muted aria-label="Camera preview" className="size-full object-cover" hidden={status !== "live"} />
        {status === "starting" && <div role="status" className="absolute inset-0 grid place-items-center text-sm text-surface">Starting camera…</div>}
        {status === "off" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-surface">
            <p>Camera is off</p>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-4 font-medium text-accent-contrast has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
              <Upload className="size-4" aria-hidden />
              Choose photo
              <input type="file" accept="image/*" className="sr-only" onChange={onFile} />
            </label>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2">
          <Upload className="size-5" aria-hidden />
          Upload
          <input type="file" accept="image/*" className="sr-only" onChange={onFile} />
        </label>
        <Button size="lg" className="size-16 !rounded-full !px-0" aria-label="Take photo" disabled={status !== "live"} onClick={shoot}>
          <Camera className="size-7" aria-hidden />
        </Button>
        <IconButton aria-label="Flip camera" variant="ghost" disabled={status === "off"} onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}>
          <FlipHorizontal2 className="size-5" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
