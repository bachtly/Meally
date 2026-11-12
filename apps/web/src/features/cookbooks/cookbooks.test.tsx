import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const on = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
const off = { ...on, enabled: false };
const summary = (n: number, name: string) => ({ id: `s${n}`, slug: `r-${n}`, name, imageUrl: null, totalMinutes: 20, servings: 2, updatedAt: n });
const recipe = {
  id: "r1", slug: "soup", name: "Soup", description: null, yieldText: null, servings: 4, prepMinutes: null, cookMinutes: null, totalMinutes: null,
  sourceUrl: null, notes: null, imageUrl: null, ingredients: [], steps: [], createdAt: 1, updatedAt: 1,
};
const book = (over: object) => ({ id: "c1", slug: "weeknight", name: "Weeknight", description: null, kind: "manual", filter: null, coverRecipe: null, covers: [], count: 0, countCapped: false, ...over });

let calls: { method: string; url: string; body?: string }[] = [];
let held: string[] = [];

function renderAt(path: string, cookbooksOn = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ method, url: u, body: init?.body as string | undefined });
      if (u.includes("/auth/me"))
        return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } });
      if (u.includes("/features")) return Response.json({ features: { cookbooks: cookbooksOn ? on : off, organizers: on, ratings: on } });
      if (u.includes("/cookbooks/containing/")) return Response.json({ items: held });
      if (u.match(/\/cookbooks\/weeknight\/recipes\/soup/) && method === "DELETE") {
        held = [];
        return new Response(null, { status: 204 });
      }
      if (u.match(/\/cookbooks\/weeknight\/recipes$/) && method === "POST") {
        held = ["weeknight"];
        return new Response(null, { status: 204 });
      }
      if (u.match(/\/cookbooks\/weeknight\/recipes/)) return Response.json({ items: [summary(1, "Lemon pasta"), summary(2, "Dal")], nextCursor: null });
      if (u.match(/\/cookbooks\/weeknight$/)) return Response.json(book({ count: 2 }));
      if (u.endsWith("/cookbooks") && method === "POST") return Response.json(book({ slug: "quick", name: "Quick", kind: "smart" }), { status: 201 });
      if (u.endsWith("/cookbooks")) return Response.json({ items: [book({ count: 2, covers: ["/api/v1/images/a/320", "/api/v1/images/b/320", "/api/v1/images/c/320"] }), book({ id: "c2", slug: "fav", name: "Favourites", kind: "smart", count: 1, countCapped: false })] });
      if (u.includes("/recipes/soup")) return Response.json(recipe);
      if (u.includes("/recipes?")) return Response.json({ items: [summary(1, "Lemon pasta")], nextCursor: null });
      if (u.includes("/organizers/")) return Response.json({ items: [] });
      return Response.json({});
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  held = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("lists cookbooks with counts and has no axe violations", async () => {
  const { container } = renderAt("/cookbooks");
  expect(await screen.findByRole("heading", { name: "Weeknight" })).toBeInTheDocument();
  expect(screen.getByText(/2 recipes · Hand-picked/)).toBeInTheDocument();
  expect(screen.getByText(/1 recipe · Smart/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New cookbook" })).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
});

it("creates a hand-picked cookbook", async () => {
  const user = userEvent.setup();
  renderAt("/cookbooks");
  await user.click(await screen.findByRole("button", { name: "New cookbook" }));
  await user.type(screen.getByLabelText("Name"), "Quick");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.endsWith("/cookbooks"))?.body).toContain('"kind":"manual"'));
});

it("shows a cookbook's recipes", async () => {
  renderAt("/cookbooks/weeknight");
  expect(await screen.findByRole("heading", { name: "Weeknight" })).toBeInTheDocument();
  expect(await screen.findByText("Lemon pasta")).toBeInTheDocument();
  expect(screen.getByText("Dal")).toBeInTheDocument();
});

it("saves the library filters as a smart cookbook", async () => {
  const user = userEvent.setup();
  renderAt("/recipes?tag=quick&category=dinner&q=pasta&favourites=1");
  await user.click(await screen.findByRole("button", { name: "Save as cookbook" }));
  expect(screen.getByText(/tag: quick/)).toBeInTheDocument();
  await user.type(screen.getByLabelText("Name"), "Quick");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/cookbooks"))).toBe(true));
  const body = JSON.parse(calls.find((c) => c.method === "POST" && c.url.endsWith("/cookbooks"))!.body!);
  expect(body).toMatchObject({ kind: "smart", filter: { q: "pasta", tag: ["quick"], category: ["dinner"], tool: [], favourites: true } });
});

it("adds and removes a recipe from a manual cookbook", async () => {
  const user = userEvent.setup();
  renderAt("/recipes/soup");
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  await user.click(await screen.findByRole("menuitem", { name: /Add to cookbook/ }));
  const box = await screen.findByRole("checkbox", { name: "Weeknight" });
  expect(box).not.toBeChecked();
  await user.click(box);
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/cookbooks/weeknight/recipes"))).toBe(true));
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Weeknight" })).toBeChecked());
  await user.click(screen.getByRole("checkbox", { name: "Weeknight" }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/cookbooks/weeknight/recipes/soup"))).toBe(true));
});

it("hides cookbooks when the flag is off", async () => {
  const user = userEvent.setup();
  renderAt("/recipes/soup", false);
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  expect(screen.queryByRole("menuitem", { name: /Add to cookbook/ })).not.toBeInTheDocument();
  cleanup();
  renderAt("/cookbooks", false);
  expect(await screen.findByText(/turned off/)).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Cookbooks" })).not.toBeInTheDocument();
});
