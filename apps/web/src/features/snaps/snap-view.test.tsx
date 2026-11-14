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
  await userEvent.setup().click(await screen.findByRole("button", { name: /Ana reacted/ }));
  expect(await screen.findByRole("heading", { name: "Reactions" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "heart" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "React" })).toBeNull();
  cleanup();
  setup("/snaps/s1", { snap: [200, snap({ author: { id: "u1", name: "Ada" }, reactions: [] })] });
  expect(await screen.findByText("No reactions yet")).toBeTruthy();
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

const mine = (extra: object = {}) => snap({ author: { id: "u1", name: "Ada" }, recipe: null, dishName: "Pho", ...extra });

function setupLink(opts: { snap?: unknown; recipes?: unknown[]; patch?: [number, unknown] } = {}) {
  const calls: { m: string; u: string; body?: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace("/api/v1", "");
      const m = init?.method ?? "GET";
      calls.push({ m, u, body: init?.body as string | undefined });
      if (u === "/auth/me") return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "member" } });
      if (u === "/features")
        return Response.json({ features: { snaps: { enabled: true, locked: false, source: "default", label: "Snaps", description: "x" } } });
      if (u === "/snaps/s1" && m === "PATCH") return Response.json(opts.patch?.[1] ?? mine(), { status: opts.patch?.[0] ?? 200 });
      if (u === "/snaps/s1") return Response.json(opts.snap ?? mine());
      if (u.startsWith("/recipes?")) return Response.json({ items: opts.recipes ?? [], nextCursor: null });
      if (u === "/recipes" && m === "POST") return Response.json({ id: "r9", slug: "pho", name: "Pho" }, { status: 201 });
      return Response.json({});
    }),
  );
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/snaps/s1"] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={router} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { calls, router };
}

it("Link: only the author sees Link a recipe", async () => {
  setupLink({ snap: snap() });
  await screen.findByAltText("Soup");
  expect(screen.queryByRole("button", { name: /Link a recipe|Change recipe/ })).toBeNull();
});

it("Link: the picker searches by the dish name and PATCHes the picked recipe", async () => {
  const { calls } = setupLink({ recipes: [{ id: "r1", slug: "pho", name: "Pho bo", imageUrl: null, totalMinutes: null, servings: null }] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Link a recipe" }));
  expect((await screen.findByLabelText("Search your recipes") as HTMLInputElement).value).toBe("Pho");
  await user.click(await screen.findByRole("button", { name: "Pho bo" }));
  await waitFor(() => expect(calls.find((c) => c.m === "PATCH")?.body).toBe(JSON.stringify({ recipeId: "r1" })));
  expect(calls.some((c) => c.u.startsWith("/recipes?") && c.u.includes("q=Pho"))).toBe(true);
});

it("Link: picker rows show the photo, time and servings, named by the recipe", async () => {
  setupLink({
    recipes: [
      { id: "r1", slug: "pho", name: "Pho bo", imageUrl: "/api/v1/recipes/pho/images/i1/800", totalMinutes: 90, servings: 4 },
      { id: "r2", slug: "pho-ga", name: "Pho ga", imageUrl: null, totalMinutes: null, servings: null },
    ],
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Link a recipe" }));
  const withPhoto = await screen.findByRole("button", { name: "Pho bo" });
  expect(withPhoto.querySelector("img")?.getAttribute("src")).toBe("/api/v1/recipes/pho/images/i1/800");
  expect(withPhoto.querySelector("img")?.getAttribute("alt")).toBe("");
  expect(withPhoto.textContent).toContain("1 h 30 min · Serves 4");
  expect(document.getElementById(withPhoto.getAttribute("aria-describedby")!)?.textContent).toBe("1 h 30 min · Serves 4");
  const bare = screen.getByRole("button", { name: "Pho ga" });
  expect(bare.querySelector("img")).toBeNull();
  expect(bare.hasAttribute("aria-describedby")).toBe(false);
});

it("Link: no match shows a New recipe action that carries the name and the Snap", async () => {
  const { router } = setupLink({ recipes: [] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Link a recipe" }));
  expect(await screen.findByText('No recipe called "Pho"')).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "New recipe" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/new"));
  expect(router.state.location.search).toBe("?name=Pho&linkSnap=s1");
  expect(((await screen.findByLabelText(/^Name/)) as HTMLInputElement).value).toBe("Pho");
});

it("Link: saving a recipe started from a Snap links it and returns to the Snap", async () => {
  const { calls, router } = setupLink({ recipes: [] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Link a recipe" }));
  await user.click(await screen.findByRole("link", { name: "New recipe" }));
  await user.click((await screen.findAllByRole("button", { name: "Save recipe" }))[0]!);
  await waitFor(() => expect(router.state.location.pathname).toBe("/snaps/s1"));
  expect(calls.find((c) => c.m === "PATCH")?.body).toBe(JSON.stringify({ recipeId: "r9" }));
});

it("Link: a 404 on link closes the picker with a message", async () => {
  setupLink({ recipes: [{ id: "r1", slug: "pho", name: "Pho bo", imageUrl: null, totalMinutes: null, servings: null }], patch: [404, { error: "not_found" }] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Link a recipe" }));
  await user.click(await screen.findByRole("button", { name: "Pho bo" }));
  expect(await screen.findByText("That recipe is no longer there")).toBeTruthy();
});

it("Link: the author can unlink from the More menu", async () => {
  const withRecipe = mine({ recipe: { slug: "pho", name: "Pho bo" } });
  const { calls } = setupLink({ snap: withRecipe, patch: [200, mine()] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More" }));
  await user.click(await screen.findByRole("menuitem", { name: "Unlink recipe" }));
  await waitFor(() => expect(calls.find((c) => c.m === "PATCH")?.body).toBe(JSON.stringify({ recipeId: null })));
  expect(await screen.findByText("Recipe unlinked")).toBeTruthy();
});

it("Reactions: a friend toggles one at once, with PUT then DELETE", async () => {
  const { calls } = setupLink({ snap: snap() });
  const user = userEvent.setup();
  const heart = await screen.findByRole("button", { name: "React with heart" });
  expect(heart).toHaveAttribute("aria-pressed", "false");
  await user.click(heart);
  expect(heart).toHaveAttribute("aria-pressed", "true");
  await waitFor(() => expect(calls.some((c) => c.m === "PUT" && c.u === "/snaps/s1/reactions/heart")).toBe(true));
  await user.click(heart);
  await waitFor(() => expect(calls.some((c) => c.m === "DELETE" && c.u === "/snaps/s1/reactions/heart")).toBe(true));
});

it("Delete: the author confirms, the Snap is deleted and the Feed opens", async () => {
  const { calls, router } = setupLink({ snap: mine() });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More" }));
  await user.click(await screen.findByRole("menuitem", { name: "Delete Snap" }));
  await user.click(await screen.findByRole("button", { name: "Delete" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/feed"));
  expect(calls.some((c) => c.m === "DELETE" && c.u === "/snaps/s1")).toBe(true);
});

it("Delete: a friend's Snap has no Delete", async () => {
  setupLink({ snap: snap() });
  await userEvent.setup().click(await screen.findByRole("button", { name: "More" }));
  expect(await screen.findByRole("menuitem", { name: "Save photo" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Delete Snap" })).toBeNull();
});
