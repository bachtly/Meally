import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";
import { FeaturesProvider } from "../features/FeaturesProvider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const snap = (extra: object = {}) => ({
  id: "s1",
  author: { id: "f1", name: "Ana" },
  imageUrl: "/api/v1/snaps/s1/images/i/800",
  thumbUrl: "/api/v1/snaps/s1/images/i/320",
  caption: "Soup",
  dishName: null,
  place: null,
  recipe: { slug: "tonkotsu", name: "Tonkotsu" },
  createdAt: Date.now() - 3600_000,
  myReactions: [],
  ...extra,
});

const recipe = (extra: object = {}) => ({
  id: "r1",
  slug: "tonkotsu",
  name: "Tonkotsu",
  description: null,
  yieldText: null,
  servings: 2,
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  sourceUrl: null,
  notes: null,
  imageUrl: null,
  ingredients: [{ position: 0, section: null, quantity: 1, unit: null, food: null, note: null, raw: "1 pork bone" }],
  steps: [{ position: 0, section: null, text: "Boil it." }],
  createdAt: 1,
  updatedAt: 1,
  savedSlug: null,
  ...extra,
});

interface Opts {
  snap?: [number, unknown];
  recipe?: [number, unknown];
  save?: [number, unknown];
}

function setup(path: string, o: Opts = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace("/api/v1", "");
      calls.push(`${init?.method ?? "GET"} ${u}`);
      const reply = (r: [number, unknown]) => Response.json(r[1], { status: r[0] });
      if (u === "/auth/me") return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "member" } });
      if (u === "/features")
        return Response.json({ features: { snaps: { enabled: true, locked: false, source: "default", label: "Snaps", description: "x" } } });
      if (u === "/snaps/s1") return reply(o.snap ?? [200, snap()]);
      if (u === "/snaps/s1/recipe/save") return reply(o.save ?? [201, { slug: "tonkotsu-2" }]);
      if (u === "/snaps/s1/recipe") return reply(o.recipe ?? [200, recipe()]);
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

it("Snap view shows the Snap, a Linked recipe link, and no reactions list for a Friend's Snap", async () => {
  setup("/snaps/s1");
  expect(await screen.findByAltText("Soup")).toBeTruthy();
  expect(screen.getByRole("link", { name: /Linked recipe: Tonkotsu/ }).getAttribute("href")).toBe("/snaps/s1/recipe");
  expect(screen.queryByText("Reactions")).toBeNull();
});

it("Snap view: an eat-out Snap shows dish and place and no recipe link", async () => {
  setup("/snaps/s1", { snap: [200, snap({ recipe: null, dishName: "Pho", place: "Cafe X" })] });
  expect(await screen.findByText("Pho · Cafe X")).toBeTruthy();
  expect(screen.queryByRole("link", { name: /Linked recipe/ })).toBeNull();
});

it("Snap view: the author sees who reacted, or an empty state", async () => {
  setup("/snaps/s1", { snap: [200, snap({ author: { id: "u1", name: "Ada" }, reactions: [{ userId: "f1", name: "Ana", emoji: "heart" }] })] });
  expect(await screen.findByText("Reactions")).toBeTruthy();
  expect(screen.getByText("Ana: heart")).toBeTruthy();
  cleanup();
  setup("/snaps/s1", { snap: [200, snap({ author: { id: "u1", name: "Ada" }, reactions: [] })] });
  expect(await screen.findByText("No reactions yet.")).toBeTruthy();
});

it("Snap view: 404 is a dead link, other failures can be retried", async () => {
  setup("/snaps/s1", { snap: [404, { error: "not_found" }] });
  expect(await screen.findByText("This link no longer works")).toBeTruthy();
  cleanup();
  setup("/snaps/s1", { snap: [500, { error: "boom" }] });
  expect(await screen.findByText("Couldn't load this Snap")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("Linked recipe: read-only view with Save to my recipes, which opens the copy", async () => {
  const { calls, router } = setup("/snaps/s1/recipe");
  expect(await screen.findByRole("heading", { name: "Tonkotsu" })).toBeTruthy();
  expect(screen.getByText("From Ana")).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Save to my recipes" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/tonkotsu-2"));
  expect(calls).toContain("POST /snaps/s1/recipe/save");
});

it("Linked recipe: an existing copy shows Open my copy instead of Save", async () => {
  setup("/snaps/s1/recipe", { recipe: [200, recipe({ savedSlug: "my-tonkotsu" })] });
  const open = await screen.findByRole("link", { name: "Open my copy" });
  expect(open.getAttribute("href")).toBe("/recipes/my-tonkotsu");
  expect(screen.queryByRole("button", { name: "Save to my recipes" })).toBeNull();
});

it("Linked recipe: a failed save keeps the button and says so", async () => {
  setup("/snaps/s1/recipe", { save: [500, { error: "boom" }] });
  await userEvent.setup().click(await screen.findByRole("button", { name: "Save to my recipes" }));
  expect(await screen.findByText(/Couldn't save the recipe/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save to my recipes" })).toBeTruthy();
});

it("Linked recipe: own_recipe on save opens the author's own recipe", async () => {
  const { router } = setup("/snaps/s1/recipe", { save: [409, { error: "own_recipe", message: "mine" }] });
  await userEvent.setup().click(await screen.findByRole("button", { name: "Save to my recipes" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/tonkotsu"));
});

it("Linked recipe: your own Snap opens the editable recipe", async () => {
  const { router } = setup("/snaps/s1/recipe", { snap: [200, snap({ author: { id: "u1", name: "Ada" } })] });
  await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/tonkotsu"));
});

it("Linked recipe: 404 and a Snap without a recipe are dead links; errors can be retried", async () => {
  setup("/snaps/s1/recipe", { recipe: [404, { error: "not_found" }] });
  expect(await screen.findByText("This link no longer works")).toBeTruthy();
  cleanup();
  setup("/snaps/s1/recipe", { snap: [200, snap({ recipe: null })] });
  expect(await screen.findByText("This link no longer works")).toBeTruthy();
  cleanup();
  setup("/snaps/s1/recipe", { recipe: [500, { error: "boom" }] });
  expect(await screen.findByText("Couldn't load this recipe")).toBeTruthy();
});
