import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { appRoutes } from "../app/App";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { PwaProvider } from "../pwa/Pwa";
import { baseRoutes, installMockApi, type Routes } from "./mockApi";

export type CameraMode = "live" | "off";

/** A fake camera: a canvas stream with a dish drawn on it, or a denied permission. */
export function installCamera(mode: CameraMode) {
  const getUserMedia = async (): Promise<MediaStream> => {
    if (mode === "off") throw new DOMException("Permission denied", "NotAllowedError");
    const c = document.createElement("canvas");
    c.width = 600;
    c.height = 800;
    const g = c.getContext("2d")!;
    let t = 0;
    const stream = c.captureStream(30);
    const track = stream.getVideoTracks()[0];
    const draw = () => {
      t += 1;
      g.fillStyle = "#6b5a44";
      g.fillRect(0, 0, 600, 800);
      g.fillStyle = "#efe9df";
      g.beginPath();
      g.arc(300 + Math.sin(t / 30) * 6, 400, 230, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#c27a3a";
      g.beginPath();
      g.arc(300 + Math.sin(t / 30) * 6, 400, 190, 0, Math.PI * 2);
      g.fill();
      // The app stops the track on shutter and route leave; stop drawing with it.
      if (track?.readyState !== "ended") requestAnimationFrame(draw);
    };
    draw();
    return stream;
  };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
}

/** Forgets the unsent Snap, so each story starts clean. */
export const clearDrafts = () =>
  new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("meally-snaps");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });

/**
 * One real app screen: the app's own routes and providers, at `path`, with the API answered by `routes`
 * (merged over `baseRoutes`). A fresh query cache per story keeps stories independent.
 */
export function Screen({ path, routes = {} }: { path: string; routes?: Routes }) {
  const [state] = useState(() => {
    installMockApi({ ...baseRoutes, ...routes });
    return {
      qc: new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } }),
      router: createMemoryRouter(appRoutes, { initialEntries: [path] }),
    };
  });
  return (
    <QueryClientProvider client={state.qc}>
      <FeaturesProvider>
        <PwaProvider>
          <RouterProvider router={state.router} />
        </PwaProvider>
      </FeaturesProvider>
    </QueryClientProvider>
  );
}
