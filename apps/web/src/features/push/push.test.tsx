import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationsSection } from "./NotificationsSection";
import type { PushEnv } from "./push";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

interface Fake {
  ios?: boolean;
  standalone?: boolean;
  noPush?: boolean;
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  subscribed?: boolean;
}

function fakeEnv(f: Fake = {}) {
  const unsubscribe = vi.fn(async () => true);
  let current: PushSubscription | null = null;
  const makeSub = () =>
    ({
      endpoint: "https://fcm.googleapis.com/fcm/send/dev",
      toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/dev", keys: { p256dh: "pk", auth: "au" } }),
      unsubscribe,
    }) as unknown as PushSubscription;
  if (f.subscribed) current = makeSub();
  const subscribe = vi.fn(async () => (current = makeSub()));
  const reg = { pushManager: { getSubscription: async () => current, subscribe } } as unknown as ServiceWorkerRegistration;
  const nav = {
    userAgent: f.ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" : "Mozilla/5.0 (X11; Linux x86_64)",
    platform: f.ios ? "iPhone" : "Linux",
    maxTouchPoints: 0,
    standalone: f.standalone,
    ...(f.noPush ? {} : { serviceWorker: { getRegistration: async () => reg, ready: Promise.resolve(reg) } }),
  } as unknown as Navigator;
  const Notification = { permission: f.permission ?? "default", requestPermission: vi.fn(async () => f.answer ?? "granted") };
  const win = {
    matchMedia: () => ({ matches: !!f.standalone }),
    ...(f.noPush ? {} : { PushManager: class {}, Notification }),
  } as unknown as Window & typeof globalThis;
  return { env: { nav, win } satisfies PushEnv, subscribe, unsubscribe, Notification };
}

function stubApi(key: [number, unknown] = [200, { publicKey: KEY }]) {
  const calls: { m: string; u: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace("/api/v1", "");
      const m = init?.method ?? "GET";
      calls.push({ m, u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u === "/push/key") return Response.json(key[1], { status: key[0] });
      if (u === "/push/subscriptions" && m === "POST") return Response.json({ id: "sub1" }, { status: 201 });
      if (u.startsWith("/push/subscriptions/") && m === "DELETE") return new Response(null, { status: 204 });
      return Response.json({});
    }),
  );
  return calls;
}

it("turns on: asks permission from the tap, subscribes with the server key, saves the subscription", async () => {
  const calls = stubApi();
  const f = fakeEnv();
  render(<NotificationsSection env={f.env} />);
  const sw = await screen.findByRole("switch", { name: /New Snaps and Reactions/ });
  await waitFor(() => expect(sw).toBeEnabled());
  expect(f.Notification.requestPermission).not.toHaveBeenCalled();
  await userEvent.setup().click(sw);
  await waitFor(() => expect(sw).toHaveAttribute("data-state", "checked"));
  expect(f.Notification.requestPermission).toHaveBeenCalledOnce();
  expect(f.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  expect(calls.find((c) => c.m === "POST")?.body).toEqual({ endpoint: "https://fcm.googleapis.com/fcm/send/dev", keys: { p256dh: "pk", auth: "au" } });
  expect(localStorage.getItem("meally:push-subscription")).toBe("sub1");
});

it("turns off: unsubscribes in the browser and deletes the server's copy", async () => {
  const calls = stubApi();
  localStorage.setItem("meally:push-subscription", "sub1");
  const f = fakeEnv({ subscribed: true, permission: "granted" });
  render(<NotificationsSection env={f.env} />);
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw).toHaveAttribute("data-state", "checked"));
  await userEvent.setup().click(sw);
  await waitFor(() => expect(f.unsubscribe).toHaveBeenCalled());
  await waitFor(() => expect(calls.some((c) => c.m === "DELETE" && c.u === "/push/subscriptions/sub1")).toBe(true));
  expect(localStorage.getItem("meally:push-subscription")).toBeNull();
});

it("a refused prompt shows the blocked message and never asks again", async () => {
  stubApi();
  const f = fakeEnv({ answer: "denied" });
  render(<NotificationsSection env={f.env} />);
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw).toBeEnabled());
  await userEvent.setup().click(sw);
  expect(await screen.findByText(/blocked in your browser settings/)).toBeTruthy();
  expect(screen.queryByRole("switch")).toBeNull();
});

it("shows the Home Screen steps on an iPhone browser tab, and the switch once installed", async () => {
  stubApi();
  render(<NotificationsSection env={fakeEnv({ ios: true }).env} />);
  expect(await screen.findByText("Add Meally to your Home Screen first")).toBeTruthy();
  cleanup();
  render(<NotificationsSection env={fakeEnv({ ios: true, standalone: true }).env} />);
  expect(await screen.findByRole("switch")).toBeTruthy();
});

it("is hidden without Web Push support, and when the server has no keys", async () => {
  stubApi([503, { error: "push_unconfigured", message: "x" }]);
  const { container } = render(<NotificationsSection env={fakeEnv({ noPush: true }).env} />);
  await waitFor(() => expect(container.innerHTML).toBe(""));
  cleanup();
  const f = fakeEnv();
  const r = render(<NotificationsSection env={f.env} />);
  const sw = await screen.findByRole("switch");
  await waitFor(() => expect(sw).toBeEnabled());
  await userEvent.setup().click(sw);
  await waitFor(() => expect(r.container.innerHTML).toBe(""));
});
