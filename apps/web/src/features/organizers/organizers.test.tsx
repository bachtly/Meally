import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const ref = (name: string) => ({ name, slug: name.toLowerCase() });
const recipe = {
  id: "r1",
  slug: "tomato-soup",
  name: "Tomato soup",
  description: "Smooth.",
  yieldText: null,
  servings: 4,
  prepMinutes: null,
  cookMinutes: null,
  totalMinutes: null,
  sourceUrl: null,
  notes: null,
  imageUrl: null,
  ingredients: [],
  steps: [],
  tags: [ref("Vegan")],
  categories: [ref("Dinner")],
  tools: [ref("Blender")],
  createdAt: 1,
  updatedAt: 1,
};

let calls: Array<{ method: string; url: string; body: unknown }> = [];
let lists: Record<string, Array<{ name: string; slug: string; count: number }>> = {};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}
const routes = [{ element: (<><Outlet /><Where /></>), children: appRoutes }];

function renderAt(path: string, organizers = true) {
  const info = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, url: u, body });
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { organizers: info(organizers) } });
      const org = /\/organizers\/(\w+)(?:\/([\w-]+))?/.exec(u);
      if (org) {
        if (method === "GET") return Response.json({ items: lists[org[1]!] ?? [] });
        return method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({});
      }
      if (u.includes("/recipes/tomato-soup")) return Response.json(recipe);
      if (u.includes("/recipes?")) return Response.json({ items: [], nextCursor: null });
      return Response.json({});
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  lists = {
    tags: [
      { name: "Vegan", slug: "vegan", count: 3 },
      { name: "Quick", slug: "quick", count: 1 },
    ],
    categories: [{ name: "Dinner", slug: "dinner", count: 2 }],
    tools: [{ name: "Blender", slug: "blender", count: 1 }],
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("editor picker selects an existing name, creates a new one, and saves name arrays", async () => {
  const user = userEvent.setup();
  renderAt("/recipes/new");
  await user.type(await screen.findByLabelText("Name"), "Pancakes");
  const tags = await screen.findByRole("combobox", { name: "Tags" });
  await user.type(tags, "veg");
  await user.click(await screen.findByRole("option", { name: "Vegan" }));
  await user.type(tags, "Spicy{Enter}");
  expect(screen.getByRole("button", { name: "Remove Spicy from Tags" })).toBeInTheDocument();
  await user.type(screen.getByRole("combobox", { name: "Tools" }), "Wok");
  expect(screen.getByRole("option", { name: /Create .Wok./ })).toBeInTheDocument();
  await user.keyboard("{Enter}");
  await user.click(screen.getAllByRole("button", { name: "Save recipe" })[0]!);
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/recipes"))).toBe(true));
  const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/recipes"))!;
  expect((post.body as { tags: string[]; tools: string[] }).tools).toEqual(["Wok"]);
  expect((post.body as { tags: string[] }).tags).toContain("Spicy");
});

it("recipe page shows chips that link to the filtered library", async () => {
  renderAt("/recipes/tomato-soup");
  const link = await screen.findByRole("link", { name: "Dinner" });
  expect(link).toHaveAttribute("href", "/recipes?category=dinner");
  expect(screen.getByRole("link", { name: "Vegan" })).toHaveAttribute("href", "/recipes?tag=vegan");
  expect(screen.getByRole("link", { name: "Tool: Blender" })).toHaveAttribute("href", "/recipes?tool=blender");
});

it("library filters update the URL and the list query", async () => {
  const user = userEvent.setup();
  renderAt("/recipes?q=soup");
  await user.click(await screen.findByRole("button", { name: "Dinner" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/recipes?q=soup&category=dinner");
  await user.click(screen.getByRole("button", { name: /Filters/ }));
  const sheet = await screen.findByRole("dialog");
  expect(within(sheet).getByText("3")).toBeInTheDocument();
  await user.click(within(sheet).getByRole("checkbox", { name: /Vegan/ }));
  await user.click(within(sheet).getByRole("checkbox", { name: /Quick/ }));
  await user.click(within(sheet).getByRole("button", { name: "Done" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/recipes?q=soup&category=dinner&tag=vegan&tag=quick");
  await waitFor(() => expect(calls.some((c) => c.url.includes("tag=vegan&tag=quick") && c.url.includes("category=dinner"))).toBe(true));
  expect(await axe(screen.getByRole("main"))).toHaveNoViolations();
  await user.click(screen.getByRole("button", { name: "Remove filter tag: Vegan" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/recipes?q=soup&category=dinner&tag=quick");
  await user.click(screen.getByRole("button", { name: "Clear all" }));
  expect(screen.getByTestId("where")).toHaveTextContent("/recipes?q=soup");
});

it("manage page renames, merges and deletes", async () => {
  const user = userEvent.setup();
  renderAt("/organizers");
  expect(await screen.findByText("3 recipes")).toBeInTheDocument();
  expect(await axe(screen.getByRole("main"))).toHaveNoViolations();

  await user.click(screen.getByRole("button", { name: "Actions for Quick" }));
  await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
  const input = screen.getByLabelText("New name for Quick");
  await user.clear(input);
  await user.type(input, "Fast{Enter}");
  await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ name: "Fast" }));
  expect(calls.find((c) => c.method === "PATCH")!.url).toContain("/organizers/tags/quick");

  await user.click(screen.getByRole("button", { name: "Actions for Quick" }));
  await user.click(await screen.findByRole("menuitem", { name: /Merge into/ }));
  await user.selectOptions(screen.getByLabelText("Merge into"), "vegan");
  await user.click(screen.getByRole("button", { name: "Merge" }));
  await waitFor(() => expect(calls.find((c) => c.method === "POST" && c.url.includes("/merge"))?.body).toEqual({ into: "vegan" }));

  await user.click(screen.getByRole("button", { name: "Actions for Vegan" }));
  await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/organizers/tags/vegan"))).toBe(true));

  await user.click(screen.getByRole("tab", { name: "Tools" }));
  expect(await screen.findByText("Blender")).toBeInTheDocument();
});

it("hides everything when the flag is off", async () => {
  renderAt("/recipes/tomato-soup", false);
  await screen.findByRole("heading", { name: "Tomato soup" });
  expect(screen.queryByRole("link", { name: "Dinner" })).toBeNull();
  cleanup();
  renderAt("/recipes", false);
  await screen.findByRole("heading", { name: "Recipes" });
  expect(screen.queryByRole("button", { name: /Filters/ })).toBeNull();
  expect(calls.some((c) => c.url.includes("/organizers/"))).toBe(false);
  cleanup();
  renderAt("/recipes/new", false);
  await screen.findByLabelText("Name");
  expect(screen.queryByRole("combobox", { name: "Tags" })).toBeNull();
});
