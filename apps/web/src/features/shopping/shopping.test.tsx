import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ShoppingItem } from "@meally/shared";
import { appRoutes } from "../../app/App";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { ToastProvider } from "../../ui";
import { groupItems } from "./model";

expect.extend(matchers);

const item = (id: string, text: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id, listId: "l1", text, quantity: null, unit: null, food: null, note: null, aisle: null, checked: false, position: 0, recipeRefs: [], updatedAt: "x", ...o,
});
const aisles = [
  { id: "a2", name: "Dairy", position: 1, color: null },
  { id: "a1", name: "Produce", position: 0, color: null },
];

let items: ShoppingItem[] = [];
let flagOn = true;
let calls: string[] = [];

class FakeES {
  static last: FakeES | undefined;
  handlers: Record<string, (() => void)[]> = {};
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeES.last = this;
  }
  addEventListener(t: string, h: () => void) {
    (this.handlers[t] ??= []).push(h);
  }
  emit(t: string) {
    this.handlers[t]?.forEach((h) => h());
  }
  close() {}
}

function renderAt(path: string) {
  const info = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const recipe = { id: "r", slug: "soup", name: "Soup", servings: 4, ingredients: [], steps: [], description: null, yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null, sourceUrl: null, notes: null, imageUrl: null, createdAt: 1, updatedAt: 1 };
  vi.stubGlobal("EventSource", FakeES);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${u}`);
      if (u.includes("/auth/me")) return Response.json({ user: { id: "u", email: "a@b.c", name: "A", role: "admin" } });
      if (u.includes("/features")) return Response.json({ features: { "shopping-lists": info(flagOn) } });
      if (u.endsWith("/recipes/soup")) return Response.json(recipe);
      if (u.includes("/shopping/aisles")) return Response.json({ items: aisles });
      if (u.endsWith("/shopping/lists")) return Response.json({ items: [{ id: "l1", name: "Weekly", total: items.length, checked: 0, createdAt: "x", updatedAt: new Date().toISOString() }] });
      if (u.includes("/items/") && method === "PATCH") {
        const b = JSON.parse(String(init?.body));
        const id = u.split("/items/")[1]!;
        items = items.map((i) => (i.id === id ? { ...i, ...b } : i));
        return Response.json(items.find((i) => i.id === id));
      }
      if (u.endsWith("/items") && method === "POST") {
        items = [...items, item("n", JSON.parse(String(init?.body)).text)];
        return Response.json({ items: [] }, { status: 201 });
      }
      if (u.endsWith("/add-recipe")) return Response.json({ items: [item("x", "x"), item("y", "y")] });
      if (u.includes("/shopping/lists/l1")) return Response.json({ list: { id: "l1", name: "Weekly", total: items.length, checked: 0, createdAt: "x", updatedAt: "x" }, items });
      return Response.json({});
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <ToastProvider>
          <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
        </ToastProvider>
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  flagOn = true;
  calls = [];
  FakeES.last = undefined;
  items = [
    item("1", "milk", { aisle: "a2", position: 1 }),
    item("2", "2 onions", { aisle: "a1", quantity: 2, food: "onions", position: 2 }),
    item("3", "foil", { position: 3 }),
    item("4", "apples", { aisle: "a1", checked: true, position: 4 }),
  ];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("groups by aisle order with No aisle last, checked items split off", () => {
  const { groups, cart } = groupItems(items, aisles);
  expect(groups.map((g) => g.name)).toEqual(["Produce", "Dairy", "No aisle"]);
  expect(cart.map((i) => i.text)).toEqual(["apples"]);
});

it("renders groups and the cart, and toggling moves an item to the cart", async () => {
  renderAt("/shopping/l1");
  const headings = await screen.findAllByRole("heading", { level: 2 });
  expect(headings.map((h) => h.textContent)).toEqual(["Produce", "Dairy", "No aisle", "In the cart (1)"]);
  await userEvent.click(screen.getByRole("checkbox", { name: "milk" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "In the cart (2)" })).toBeInTheDocument());
  expect(screen.queryByRole("heading", { name: "Dairy" })).not.toBeInTheDocument();
});

it("shows a parse preview and Enter adds the item", async () => {
  renderAt("/shopping/l1");
  const input = await screen.findByLabelText("Add item");
  await userEvent.type(input, "3 cups flour");
  expect(within(screen.getByTestId("preview")).getByText("flour")).toBeInTheDocument();
  expect(within(screen.getByTestId("preview")).getByText("Unit cup")).toBeInTheDocument();
  await userEvent.type(input, "{Enter}");
  await waitFor(() => expect(calls).toContain("POST /api/v1/shopping/lists/l1/items"));
  expect(input).toHaveValue("");
});

it("an SSE items event triggers a refetch", async () => {
  renderAt("/shopping/l1");
  await screen.findByRole("heading", { name: "Produce" });
  const es = FakeES.last!;
  expect(es.url).toBe("/api/v1/shopping/lists/l1/events");
  es.emit("ready");
  expect(await screen.findByText("Live")).toBeInTheDocument();
  const before = calls.filter((c) => c === "GET /api/v1/shopping/lists/l1").length;
  items = [...items, item("5", "bread", { position: 5 })];
  es.emit("items");
  expect(await screen.findByText("bread")).toBeInTheDocument();
  expect(calls.filter((c) => c === "GET /api/v1/shopping/lists/l1").length).toBeGreaterThan(before);
});

it("overview opens a lone list directly", async () => {
  renderAt("/shopping");
  expect(await screen.findByRole("heading", { name: "Produce" })).toBeInTheDocument();
});

it("recipe page offers the action only when the flag is on", async () => {
  renderAt("/recipes/soup");
  await userEvent.click(await screen.findByRole("button", { name: "Add to shopping list" }));
  await userEvent.click(await screen.findByRole("button", { name: "More servings" }));
  await userEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(await screen.findByText("Added 2 items")).toBeInTheDocument();
  expect(calls).toContain("POST /api/v1/shopping/lists/l1/add-recipe");
});

it("recipe page hides the action when the flag is off", async () => {
  flagOn = false;
  renderAt("/recipes/soup");
  await screen.findByRole("heading", { name: "Soup" });
  expect(screen.queryByRole("button", { name: "Add to shopping list" })).not.toBeInTheDocument();
});

it("list page has no axe violations", async () => {
  const { container } = renderAt("/shopping/l1");
  await screen.findByRole("heading", { name: "Produce" });
  expect(await axe(container)).toHaveNoViolations();
});
