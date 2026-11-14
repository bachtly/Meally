import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";
import { clearOfflineCaches } from "../../pwa/register";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { FEED_STORE_KEY } from "./api";

const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "member" } };

const snap = (id: string, extra: object = {}) => ({
  id,
  author: { id: "f1", name: "Ana" },
  imageUrl: `/api/v1/snaps/${id}/images/i/800`,
  thumbUrl: `/api/v1/snaps/${id}/images/i/320`,
  caption: `Snap ${id}`,
  dishName: null,
  place: null,
  recipe: null,
  createdAt: Date.now() - 3600_000,
  myReactions: [],
  ...extra,
});

const store = (userId: string, items: unknown[]) => localStorage.setItem(FEED_STORE_KEY, JSON.stringify({ userId, page: { items, nextCursor: null } }));

beforeEach(() => {
  // The stored session lets the app render at once, as it does on a returning device.
  localStorage.setItem("meally:session", JSON.stringify(me));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

type Reply = Response | Promise<Response>;

/** `feed` and `one` answer GET /snaps?… and GET /snaps/:id; the default never answers (a slow network). */
function setup(path: string, o: { feed?: () => Reply; one?: () => Reply } = {}) {
  const calls: string[] = [];
  const pending = () => new Promise<Response>(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url).replace("/api/v1", "");
      calls.push(u);
      if (u === "/auth/me") return Response.json(me);
      if (u === "/features")
        return Response.json({ features: { snaps: { enabled: true, locked: false, source: "default", label: "Snaps", description: "x" } } });
      if (u.startsWith("/snaps?")) return (o.feed ?? pending)();
      if (/^\/snaps\/[^/]+$/.test(u)) return (o.one ?? pending)();
      return Response.json({});
    }),
  );
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={router} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { calls, router };
}

it("shows the last Feed from the device before the network answers, then refreshes it", async () => {
  store("u1", [snap("a")]);
  let answer!: (r: Response) => void;
  const { calls } = setup("/feed", { feed: () => new Promise((r) => (answer = r)) });
  expect(await screen.findByRole("link", { name: /Snap a$/ })).toBeTruthy();
  expect(screen.queryByLabelText("Loading the Feed")).toBeNull();
  // It still revalidates in the background, and the fresh page replaces the stored one.
  await waitFor(() => expect(calls.some((c) => c.startsWith("/snaps?"))).toBe(true));
  answer(Response.json({ items: [snap("b"), snap("a")], nextCursor: null }));
  expect(await screen.findByRole("link", { name: /Snap b$/ })).toBeTruthy();
  await waitFor(() => expect(JSON.parse(localStorage.getItem(FEED_STORE_KEY)!).page.items).toHaveLength(2));
});

it("keeps the cached Feed on screen when the refresh fails", async () => {
  store("u1", [snap("a")]);
  const { calls } = setup("/feed", { feed: () => Response.json({ error: "boom" }, { status: 500 }) });
  await waitFor(() => expect(calls.some((c) => c.startsWith("/snaps?"))).toBe(true));
  expect(await screen.findByRole("link", { name: /Snap a$/ })).toBeTruthy();
  expect(screen.queryByText("Couldn't load the Feed")).toBeNull();
});

it("never shows another user's stored Feed", async () => {
  store("someone-else", [snap("a")]);
  setup("/feed");
  expect(await screen.findByLabelText("Loading the Feed")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Snap a$/ })).toBeNull();
});

it("opens a Snap from the grid at once from the Feed cache", async () => {
  store("u1", [snap("a")]);
  const { router } = setup("/feed");
  await userEvent.setup().click(await screen.findByRole("link", { name: /Snap a$/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/snaps/a"));
  // GET /snaps/a never answers here, yet the Snap is already on screen, with the thumbnail behind the full photo.
  const img = await screen.findByAltText("Snap a");
  expect(img).toHaveAttribute("src", "/api/v1/snaps/a/images/i/800");
  expect(img.style.backgroundImage).toContain("/api/v1/snaps/a/images/i/320");
  expect(screen.queryByLabelText("Loading the Snap")).toBeNull();
});

it("a deleted Snap is still a dead end, even when the Feed cache has it", async () => {
  store("u1", [snap("a")]);
  setup("/feed", { one: () => Response.json({ error: "not_found" }, { status: 404 }) });
  await userEvent.setup().click(await screen.findByRole("link", { name: /Snap a$/ }));
  expect(await screen.findByText("This link no longer works")).toBeTruthy();
});

it("the camera screen loads the Feed so the grid is ready", async () => {
  const { calls } = setup("/", { feed: () => Response.json({ items: [snap("a")], nextCursor: null }) });
  await waitFor(() => expect(calls.some((c) => c.startsWith("/snaps?"))).toBe(true));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(FEED_STORE_KEY)!)).toMatchObject({ userId: "u1", page: { items: [{ id: "a" }] } }));
});

it("sign-out removes the stored Feed", async () => {
  store("u1", [snap("a")]);
  await clearOfflineCaches();
  expect(localStorage.getItem(FEED_STORE_KEY)).toBeNull();
});
