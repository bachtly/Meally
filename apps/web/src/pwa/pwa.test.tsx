import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { matchers, OFFLINE_CACHES, runtimeCaching } from "../../pwa/runtimeCaching";
import { OfflineBanner, PwaProvider, UpdateToast } from "./Pwa";
import { syncServiceWorker } from "./register";

function fakeSw(over: Partial<Record<string, unknown>> = {}) {
  const reg = { waiting: null, installing: null, unregister: vi.fn().mockResolvedValue(true), addEventListener: vi.fn() };
  const sw = {
    controller: {},
    register: vi.fn().mockResolvedValue(reg),
    getRegistrations: vi.fn().mockResolvedValue([reg]),
    addEventListener: vi.fn(),
    ...over,
  };
  return { sw: sw as unknown as ServiceWorkerContainer, reg, raw: sw };
}

describe("syncServiceWorker", () => {
  it("registers /sw.js when the flag is on", async () => {
    const { sw, raw } = fakeSw();
    await syncServiceWorker(true, { sw, onUpdate: vi.fn() });
    expect(raw.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
  });
  it("unregisters existing workers and never registers when off", async () => {
    const { sw, reg, raw } = fakeSw();
    await syncServiceWorker(false, { sw, onUpdate: vi.fn() });
    expect(reg.unregister).toHaveBeenCalled();
    expect(raw.register).not.toHaveBeenCalled();
  });
  it("does nothing without service worker support", async () => {
    await expect(syncServiceWorker(true, { sw: undefined, onUpdate: vi.fn() })).resolves.toBeUndefined();
  });
  it("offers an update when a worker is already waiting, and asks it to skip waiting", async () => {
    const worker = { postMessage: vi.fn() };
    const { sw, reg } = fakeSw();
    (reg as { waiting: unknown }).waiting = worker;
    const onUpdate = vi.fn();
    await syncServiceWorker(true, { sw, onUpdate });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![1]).toBe(true); // already waiting at start
    onUpdate.mock.calls[0]![0]();
    expect(worker.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
  it("checks for a new version when the app comes back to the front", async () => {
    const { sw, reg } = fakeSw();
    const update = vi.fn().mockResolvedValue(undefined);
    Object.assign(reg, { update });
    const doc = new EventTarget() as EventTarget & { visibilityState: string };
    doc.visibilityState = "hidden";
    await syncServiceWorker(true, { sw, onUpdate: vi.fn(), doc: doc as unknown as Document });
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(update).not.toHaveBeenCalled();
    doc.visibilityState = "visible";
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(1);
  });
  it("does not call a first install an update", async () => {
    const { sw, reg } = fakeSw({ controller: null });
    (reg as { waiting: unknown }).waiting = { postMessage: vi.fn() };
    const onUpdate = vi.fn();
    await syncServiceWorker(true, { sw, onUpdate });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("offline banner", () => {
  it("shows only while offline, following window events", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    render(
      <PwaProvider>
        <OfflineBanner />
      </PwaProvider>,
    );
    expect(screen.queryByText(/You're offline/)).toBeNull();
    act(() => window.dispatchEvent(new Event("offline")));
    expect(screen.getByText("You're offline. Recently viewed recipes still work.")).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.queryByText(/You're offline/)).toBeNull();
  });
});

describe("update toast", () => {
  it("offers Reload", async () => {
    const onReload = vi.fn();
    render(<UpdateToast onReload={onReload} />);
    expect(screen.getByText("A new version is ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe("runtime caching rules", () => {
  const ctx = (path: string, method = "GET") => ({ url: new URL(path, "https://x.test"), request: { method } });
  const first = (c: ReturnType<typeof ctx>) => runtimeCaching.filter((r) => r.urlPattern(c)).map((r) => r.options.cacheName);

  it("caches recipe detail, list and images", () => {
    expect(first(ctx("/api/v1/recipes/pasta"))).toEqual(["recipes"]);
    expect(first(ctx("/api/v1/recipes?q=a"))).toEqual(["recipes-list"]);
    expect(first(ctx("/api/v1/images/abc/800"))).toEqual(["images"]);
  });
  it("keeps images cache-first in their own cache, cleared on sign-out", () => {
    const images = runtimeCaching.find((r) => r.urlPattern === matchers.images)!;
    expect(images.handler).toBe("CacheFirst");
    expect(images.options).toMatchObject({ cacheName: "images", cacheableResponse: { statuses: [200] } });
    expect(OFFLINE_CACHES).toContain("images");
  });
  it("matchers still work when rebuilt from source, as Workbox does in sw.js", () => {
    // Workbox writes each matcher into sw.js with toString(), so any helper it closes over is undefined there.
    for (const [name, fn] of Object.entries(matchers)) {
      const rebuilt = new Function(`"use strict"; return (${fn.toString()});`)() as typeof fn;
      for (const p of ["/api/v1/recipes/pasta", "/api/v1/recipes", "/api/v1/images/a/320", "/api/v1/features", "/api/v1/auth/me"]) {
        expect(() => rebuilt(ctx(p)), `${name} ${p}`).not.toThrow();
        expect(rebuilt(ctx(p))).toBe(fn(ctx(p)));
      }
    }
  });
  it("uses the specified strategies and limits", () => {
    const detail = runtimeCaching.find((r) => r.urlPattern === matchers.recipeDetail)!;
    expect(detail.handler).toBe("StaleWhileRevalidate");
    expect(detail.options).toMatchObject({ cacheName: "recipes", expiration: { maxEntries: 100, maxAgeSeconds: 2592000 } });
    const list = runtimeCaching.find((r) => r.urlPattern === matchers.recipeList)!;
    expect(list.handler).toBe("NetworkFirst");
    expect(list.options).toMatchObject({ networkTimeoutSeconds: 3 });
  });
  it.each([
    "/api/v1/auth/me",
    "/api/v1/auth/login",
    "/api/v1/admin/users",
    "/api/v1/admin/features",
    "/api/v1/shopping/lists/1/events",
    "/api/v1/recipes/pasta/image",
    "/api/v1/household",
    "/api/v1/public/recipes/tok",
  ])("never caches %s", (p) => expect(first(ctx(p))).toEqual([]));
  it("never caches non-GET requests", () => {
    for (const m of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(first(ctx("/api/v1/recipes/pasta", m))).toEqual([]);
      expect(first(ctx("/api/v1/recipes", m))).toEqual([]);
    }
  });
});
