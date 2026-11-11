import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";
import { PwaProvider } from "../../pwa/Pwa";

expect.extend(matchers);

const on = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
const pub = {
  name: "Soup", description: "Warm.", yieldText: null, servings: 4, prepMinutes: 5, cookMinutes: 10, totalMinutes: 15, sourceUrl: null, notes: null,
  imageUrl: null, scaling: true,
  ingredients: [{ position: 0, section: null, raw: "1 cup milk", quantity: 1, unit: "cup", food: "milk", note: null }],
  steps: [{ position: 0, section: null, text: "Stir." }],
};
const item = (n: number) => ({ slug: `r-${n}`, name: `Dish ${n}`, imageUrl: null, totalMinutes: 10, servings: 2 });
const recipeLink = { kind: "recipe", title: "Soup", note: "So good", sharedBy: "Ada", count: 1, recipe: pub, items: [{ ...item(0), slug: "soup", name: "Soup" }] };
const setLink = (n: number) => ({ kind: "set", title: "Weekend", note: null, sharedBy: "Ada", count: n, recipe: null, items: Array.from({ length: n }, (_, i) => item(i + 1)) });
const mine = {
  id: "m1", slug: "soup-2", name: "Soup", description: null, yieldText: null, servings: 4, prepMinutes: null, cookMinutes: null, totalMinutes: null,
  sourceUrl: null, notes: null, imageUrl: null, ingredients: [], steps: [], createdAt: 1, updatedAt: 1, savedFrom: { name: "Ada", at: Date.UTC(2026, 10, 3) },
};

let calls: { method: string; url: string; body?: string }[] = [];
let cfg: { signedIn: boolean; share: object | null; status: { sameHousehold: boolean; saved: Record<string, string> }; signupMode: string };

function renderAt(path: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ method, url: u, body: init?.body as string | undefined });
      if (u.includes("/auth/me"))
        return cfg.signedIn
          ? Response.json({ user: { id: "u2", email: "b@example.com", name: "Bob", role: "member", householdId: "h2" }, household: { id: "h2", name: "Bob's" } })
          : Response.json({ error: "unauthenticated" }, { status: 401 });
      if (u.includes("/auth/status")) return Response.json({ needsSetup: false, signupMode: cfg.signupMode });
      if (u.includes("/features")) return Response.json({ features: { "share-links": on, cookbooks: on, pwa: on } });
      if (u.match(/\/public\/shares\/[^/]+\/recipes\//)) return Response.json(pub);
      if (u.includes("/public/shares/")) return cfg.share ? Response.json(cfg.share) : Response.json({ error: "not_found" }, { status: 404 });
      if (u.includes("/save") && method === "POST") {
        const body = JSON.parse(init!.body as string) as { slugs: string[]; cookbook?: { name?: string; slug?: string } };
        return Response.json(
          { saved: Object.fromEntries(body.slugs.map((s) => [s, s === "soup" ? "soup-2" : `${s}-mine`])), cookbookSlug: body.cookbook ? "weekend" : null },
          { status: 201 },
        );
      }
      if (u.includes("/shares/received/")) return Response.json(cfg.status);
      if (u.includes("/recipes/soup-2")) return Response.json(mine);
      if (u.match(/\/cookbooks\/weekend$/)) return Response.json({ id: "c1", slug: "weekend", name: "Weekend", description: null, kind: "manual", filter: null, coverRecipe: null, covers: [], count: 12, countCapped: false });
      if (u.includes("/cookbooks/weekend/recipes")) return Response.json({ items: [], nextCursor: null });
      return Response.json({});
    }),
  );
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <PwaProvider>
          <RouterProvider router={router} />
        </PwaProvider>
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { view, router };
}

beforeEach(() => {
  calls = [];
  localStorage.clear();
  cfg = { signedIn: false, share: recipeLink, status: { sameHousehold: false, saved: {} }, signupMode: "open" };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const saves = () => calls.filter((c) => c.method === "POST" && c.url.includes("/save")).map((c) => JSON.parse(c.body!));

it("a newcomer sees who shared it and the note, and Save leads to sign-up that comes back to save", async () => {
  const { view } = renderAt("/s/abc");
  expect(await screen.findByRole("heading", { name: "Soup" })).toBeInTheDocument();
  expect(screen.getByText("Ada")).toBeInTheDocument();
  expect(screen.getByText(/Shared by/)).toBeInTheDocument();
  expect(screen.getByText("So good")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Tab bar" })).toBeNull();
  // Still scales servings like before.
  await userEvent.click(screen.getByRole("button", { name: "More servings" }));
  expect(screen.getByText("1¼ cups milk")).toBeInTheDocument();
  expect(await axe(view.container)).toHaveNoViolations();
  await userEvent.click(screen.getByRole("button", { name: "Save to my recipes" }));
  const dialog = await screen.findByRole("dialog", { name: "Keep this recipe" });
  const next = encodeURIComponent("/s/abc/soup?save=1");
  expect(within(dialog).getByRole("link", { name: "Create account and save" })).toHaveAttribute("href", `/sign-up?next=${next}`);
  expect(within(dialog).getByRole("link", { name: "I have an account" })).toHaveAttribute("href", `/signin?next=${next}`);
  expect(saves()).toEqual([]);
});

it("on a server with closed sign-ups, only offers sign in", async () => {
  cfg.signupMode = "closed";
  renderAt("/s/abc");
  await userEvent.click(await screen.findByRole("button", { name: "Save to my recipes" }));
  const dialog = await screen.findByRole("dialog", { name: "Keep this recipe" });
  expect(await within(dialog).findByText(/Sign-ups are closed on this server/)).toBeInTheDocument();
  expect(within(dialog).queryByRole("link", { name: "Create account and save" })).toBeNull();
});

it("shows a friendly state when the link no longer works", async () => {
  cfg.share = null;
  const { view } = renderAt("/s/dead");
  expect(await screen.findByText("This link no longer works")).toBeInTheDocument();
  expect(await axe(view.container)).toHaveNoViolations();
});

it("signed in: opens inside the app, saves the recipe, and lands on my copy with who shared it and the install card", async () => {
  cfg.signedIn = true;
  const pwaPrompt = Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn(async () => {}) });
  renderAt("/s/abc");
  expect(await screen.findByRole("heading", { name: "Soup" })).toBeInTheDocument();
  expect(await screen.findByRole("navigation", { name: "Tab bar" })).toBeInTheDocument();
  window.dispatchEvent(pwaPrompt);
  await userEvent.click(await screen.findByRole("button", { name: "Save to my recipes" }));
  expect(await screen.findByText(/Saved to your recipes/)).toBeInTheDocument();
  expect(saves()).toEqual([{ slugs: ["soup"] }]);
  expect(screen.getByText(/· saved .*2026/)).toBeInTheDocument();
  expect(screen.getByText("Ada")).toBeInTheDocument();
  const card = screen.getByRole("complementary", { name: "Install Meally" });
  await userEvent.click(within(card).getByRole("button", { name: "Not now" }));
  expect(screen.queryByRole("complementary", { name: "Install Meally" })).toBeNull();
  expect(localStorage.getItem("meally.install-card.dismissed")).toBe("1");
});

it("signed in: an already-saved recipe offers my copy, and my own household's link says so", async () => {
  cfg.signedIn = true;
  cfg.status = { sameHousehold: false, saved: { soup: "soup-2" } };
  renderAt("/s/abc");
  expect(await screen.findByRole("link", { name: "Open my copy" })).toHaveAttribute("href", "/recipes/soup-2");
  cleanup();
  cfg.status = { sameHousehold: true, saved: { soup: "soup" } };
  renderAt("/s/abc");
  expect(await screen.findByText("This recipe is already in your household.")).toBeInTheDocument();
});

it("after sign-up, ?save=1 saves the recipe by itself and opens my copy", async () => {
  cfg.signedIn = true;
  const { router } = renderAt("/s/abc/soup?save=1");
  await waitFor(() => expect(router.state.location.pathname).toBe("/recipes/soup-2"));
  expect(saves()).toEqual([{ slugs: ["soup"] }]);
  expect(await screen.findByText(/Saved to your recipes/)).toBeInTheDocument();
});

it("a set: grid of recipes, Save all in batches of 10 into one new cookbook", async () => {
  cfg.signedIn = true;
  cfg.share = setLink(12);
  cfg.status = { sameHousehold: false, saved: { "r-2": "r-2-mine" } };
  const { router, view } = renderAt("/s/abc");
  expect(await screen.findByRole("heading", { name: "Weekend" })).toBeInTheDocument();
  expect(screen.getByText(/Shared recipes · 12 recipes/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Dish 3/ })).toHaveAttribute("href", "/s/abc/r-3");
  expect(await screen.findByText("Saved")).toBeInTheDocument();
  expect(await axe(view.container)).toHaveNoViolations();
  await userEvent.click(await screen.findByRole("button", { name: "Save the other 11" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/cookbooks/weekend"));
  const s = saves();
  expect(s).toHaveLength(2);
  expect(s[0]).toEqual({ slugs: ["r-1", "r-3", "r-4", "r-5", "r-6", "r-7", "r-8", "r-9", "r-10", "r-11"], cookbook: { name: "Weekend" } });
  expect(s[1]).toEqual({ slugs: ["r-12"], cookbook: { slug: "weekend" } });
});

it("a recipe inside a set links back to the set", async () => {
  cfg.share = setLink(3);
  renderAt("/s/abc/r-2");
  expect(await screen.findByRole("heading", { name: "Soup" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Weekend (3 recipes)" })).toHaveAttribute("href", "/s/abc");
  expect(screen.getByRole("button", { name: "Save to my recipes" })).toBeInTheDocument();
});

it("sign-up keeps the share's next path on its sign-in link", async () => {
  renderAt(`/sign-up?next=${encodeURIComponent("/s/abc?save=1")}`);
  expect(await screen.findByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/signin?next=${encodeURIComponent("/s/abc?save=1")}`);
});
