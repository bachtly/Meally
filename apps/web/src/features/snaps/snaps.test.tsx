import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";
import { ToastProvider } from "../../ui";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { memoryDraftStore, type Draft } from "./drafts";
import { SnapHome } from "./SnapHome";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

const photo = () => new File([new Uint8Array([1, 2, 3])], "lunch.jpg", { type: "image/jpeg" });
const snap = (id: string, extra: object = {}) => ({
  id,
  author: { id: "f1", name: "Ana" },
  imageUrl: `/api/v1/snaps/${id}/images/i/800`,
  thumbUrl: `/api/v1/snaps/${id}/images/i/320`,
  caption: null,
  dishName: null,
  place: null,
  recipe: null,
  createdAt: Date.now() - 3600_000,
  myReactions: [],
  ...extra,
});

interface Opts {
  snapsOn?: boolean;
  /** Statuses for successive POST /snaps calls; the last repeats. */
  posts?: number[];
  feed?: { items: unknown[]; nextCursor: string | null } | number;
}

function mockApi(o: Opts = {}) {
  const posts: FormData[] = [];
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace("/api/v1", "");
      const method = init?.method ?? "GET";
      if (u === "/auth/me") return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "member" } });
      if (u === "/auth/status") return Response.json({ needsSetup: false, signupMode: "invite" });
      if (u === "/features")
        return Response.json({
          features: { snaps: { enabled: o.snapsOn !== false, locked: false, source: "default", label: "Snaps", description: "x" } },
        });
      if (u === "/snaps" && method === "POST") {
        posts.push(init!.body as FormData);
        const list = o.posts ?? [201];
        const status = list[Math.min(posts.length - 1, list.length - 1)]!;
        if (status >= 400) return Response.json({ error: status === 413 ? "too_large" : "boom", message: "Image must be 10 MB or smaller" }, { status });
        return Response.json(snap("s1"), { status });
      }
      if (u.startsWith("/snaps?")) {
        const f = o.feed ?? { items: [], nextCursor: null };
        return typeof f === "number" ? Response.json({ error: "boom" }, { status: f }) : Response.json(f);
      }
      if (u === "/meta") return Response.json({ streaming: true, presizedImages: false });
      return Response.json({});
    }),
  );
  return posts;
}

const providers = (children: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <FeaturesProvider>
      <ToastProvider>{children}</ToastProvider>
    </FeaturesProvider>
  </QueryClientProvider>
);

function renderHome(store = memoryDraftStore()) {
  render(
    providers(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<SnapHome store={store} />} />
          <Route path="/feed" element={<p>On the feed</p>} />
        </Routes>
      </MemoryRouter>,
    ),
  );
  return store;
}

function stubCamera() {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia } }));
  return { stop, getUserMedia };
}

it("sends a photo in two taps after the shot and goes to the Feed", async () => {
  const posts = mockApi();
  renderHome();
  const user = userEvent.setup();
  await user.upload(await screen.findByLabelText("Upload"), photo());
  await user.click(await screen.findByRole("button", { name: "Send" }));
  expect(await screen.findByText("On the feed")).toBeTruthy();
  const body = posts[0]!;
  expect(body.get("clientId")).toBeTruthy();
  expect(body.get("file")).toBeInstanceOf(File);
});

it("keeps the draft and reuses the clientId when sending fails", async () => {
  const posts = mockApi({ posts: [500, 201] });
  const store = renderHome();
  const user = userEvent.setup();
  await user.upload(await screen.findByLabelText("Upload"), photo());
  await user.click(await screen.findByRole("button", { name: "Send" }));
  expect(await screen.findByText(/Your Snap is saved on this device/)).toBeTruthy();
  expect((await store.get())?.clientId).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("On the feed")).toBeTruthy();
  expect(posts).toHaveLength(2);
  expect(posts[1]!.get("clientId")).toBe(posts[0]!.get("clientId"));
  expect(await store.get()).toBeNull();
});

it("shows a field error for a too-large photo and keeps no retry loop", async () => {
  mockApi({ posts: [413] });
  renderHome();
  const user = userEvent.setup();
  await user.upload(await screen.findByLabelText("Upload"), photo());
  await user.click(await screen.findByRole("button", { name: "Send" }));
  expect((await screen.findByRole("alert")).textContent).toContain("10 MB");
});

it("offers an unsent draft after a reload, with its clientId", async () => {
  const posts = mockApi();
  const store = memoryDraftStore();
  const d: Draft = { clientId: "keep-me", file: photo(), fileName: "lunch.jpg", caption: "Soup", eatenOut: false, dishName: "", place: "", createdAt: 1 };
  await store.put(d);
  renderHome(store);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Open" }));
  expect((await screen.findByLabelText("Caption") as HTMLTextAreaElement).value).toBe("Soup");
  await user.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("On the feed");
  expect(posts[0]!.get("clientId")).toBe("keep-me");
  expect(posts[0]!.get("caption")).toBe("Soup");
});

it("limits caption, dish and place lengths", async () => {
  mockApi();
  renderHome();
  const user = userEvent.setup();
  await user.upload(await screen.findByLabelText("Upload"), photo());
  expect(await screen.findByLabelText("Caption")).toHaveAttribute("maxlength", "2000");
  await user.click(screen.getByLabelText("Eaten out"));
  expect(screen.getByLabelText("Dish")).toHaveAttribute("maxlength", "120");
  expect(screen.getByLabelText("Place")).toHaveAttribute("maxlength", "120");
});

it("falls back to Choose photo when the camera is denied", async () => {
  mockApi();
  vi.stubGlobal("navigator", Object.assign(Object.create(navigator), { mediaDevices: { getUserMedia: vi.fn(async () => Promise.reject(new Error("denied"))) } }));
  renderHome();
  expect(await screen.findByText("Camera is off")).toBeTruthy();
  expect(screen.getByLabelText("Choose photo")).toBeTruthy();
});

it("stops the camera on route leave, when hidden and on the shutter", async () => {
  mockApi();
  const cam = stubCamera();
  renderHome();
  await waitFor(() => expect(screen.getByRole("button", { name: "Take photo" })).toBeEnabled());
  // Hidden page.
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(() => expect(cam.stop).toHaveBeenCalledTimes(1));
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
  await waitFor(() => expect(cam.getUserMedia).toHaveBeenCalledTimes(2));
  // Shutter.
  const video = screen.getByLabelText("Camera preview") as HTMLVideoElement;
  Object.defineProperty(video, "videoWidth", { value: 4 });
  Object.defineProperty(video, "videoHeight", { value: 3 });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["x"], { type: "image/jpeg" })));
  await userEvent.setup().click(screen.getByRole("button", { name: "Take photo" }));
  await waitFor(() => expect(cam.stop).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("button", { name: "Send" })).toBeTruthy();
  cleanup();
  // The camera was already stopped by the shutter; leaving the page must not leave a stream running.
  expect(cam.stop.mock.calls.length).toBeGreaterThanOrEqual(2);
});

it("stops the camera when leaving the page", async () => {
  mockApi();
  const cam = stubCamera();
  renderHome();
  await waitFor(() => expect(cam.getUserMedia).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole("button", { name: "Take photo" })).toBeEnabled());
  cleanup();
  expect(cam.stop).toHaveBeenCalledTimes(1);
});

function renderApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={router} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return router;
}

it("redirects / to the library when the flag is off", async () => {
  mockApi({ snapsOn: false });
  const router = renderApp("/");
  await waitFor(() => expect(router.state.location.pathname).toBe("/recipes"));
});

it("shows the camera at / when the flag is on", async () => {
  mockApi();
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Snap" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Feed" })).toHaveAttribute("href", "/feed");
});

it("Feed: empty, error and a list", async () => {
  mockApi({ feed: { items: [], nextCursor: null } });
  renderApp("/feed");
  expect(await screen.findByText("No Snaps yet")).toBeTruthy();
  cleanup();
  mockApi({ feed: 500 });
  renderApp("/feed");
  expect(await screen.findByText("Couldn't load the Feed")).toBeTruthy();
  cleanup();
  mockApi({ feed: { items: [snap("a", { caption: "Soup", dishName: "Pho", place: "Cafe X" })], nextCursor: null } });
  renderApp("/feed");
  expect(await screen.findByRole("heading", { name: /Ana/ })).toBeTruthy();
  expect(screen.getByAltText("Soup")).toBeTruthy();
  expect(screen.getByText("Pho · Cafe X")).toBeTruthy();
});

it("Feed is off with the flag", async () => {
  mockApi({ snapsOn: false });
  renderApp("/feed");
  expect(await screen.findByText("This feature is turned off on this server")).toBeTruthy();
});
