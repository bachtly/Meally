import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const recipe = {
  id: "r1",
  slug: "tomato-soup",
  name: "Tomato soup",
  description: "Smooth.",
  yieldText: null,
  servings: 4,
  prepMinutes: 10,
  cookMinutes: 30,
  totalMinutes: 40,
  sourceUrl: "https://www.example.com/soup",
  notes: "Good with toast.",
  imageUrl: null,
  ingredients: [
    { position: 0, section: "Base", raw: "1 onion", quantity: null, unit: null, food: null, note: null },
    { position: 1, section: "Soup", raw: "800 g tomatoes", quantity: null, unit: null, food: null, note: null },
  ],
  steps: [
    { position: 0, section: null, text: "Soften the onion." },
    { position: 1, section: null, text: "Simmer." },
  ],
  createdAt: 1,
  updatedAt: 1,
};
const summary = (n: number, name: string) => ({ id: `s${n}`, slug: `r-${n}`, name, imageUrl: null, totalMinutes: 20, servings: 2, updatedAt: n });

let calls: string[] = [];
let deleted = false;

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

const withWhere = [
  {
    element: (
      <>
        <Outlet />
        <Where />
      </>
    ),
    children: appRoutes,
  },
];

function renderAt(path: string) {
  const info = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? "GET"} ${u}`);
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { "import-url": info } });
      if (u.includes("/recipes/tomato-soup")) {
        if (init?.method === "DELETE") {
          deleted = true;
          return new Response(null, { status: 204 });
        }
        return Response.json(recipe);
      }
      if (u.includes("/recipes/missing")) return Response.json({ error: "not_found", message: "nope" }, { status: 404 });
      if (u.includes("/recipes?")) {
        const q = new URL(u, "http://x").searchParams.get("q");
        return Response.json({ items: q ? [summary(9, "Lemon pasta")] : [summary(1, "Tomato soup"), summary(2, "Banana pancakes")], nextCursor: null });
      }
      return Response.json({});
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(withWhere, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
  deleted = false;
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders the library grid", async () => {
  renderAt("/recipes");
  expect(await screen.findByRole("link", { name: /Tomato soup/ })).toHaveAttribute("href", "/recipes/r-1");
  expect(screen.getByRole("link", { name: /Banana pancakes/ })).toBeInTheDocument();
});

it("search updates ?q and refetches", async () => {
  renderAt("/recipes");
  await screen.findByRole("link", { name: /Tomato soup/ });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search recipes" }), { target: { value: "lemon" } });
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/recipes?q=lemon"));
  expect(await screen.findByRole("link", { name: /Lemon pasta/ })).toBeInTheDocument();
  expect(calls.some((c) => c.includes("q=lemon"))).toBe(true);
});

it("recipe page renders sections and persists checks", async () => {
  const first = renderAt("/recipes/tomato-soup");
  expect(await screen.findByRole("heading", { name: "Ingredients" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Steps" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Notes" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Base" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /example\.com/ })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("checkbox", { name: "1 onion" }));
  expect(JSON.parse(localStorage.getItem("meally:checks:tomato-soup")!)).toEqual({ ingredients: [0], steps: [] });
  first.unmount();

  renderAt("/recipes/tomato-soup");
  expect(await screen.findByRole("checkbox", { name: "1 onion" })).toBeChecked();
  await userEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.getByRole("checkbox", { name: "1 onion" })).not.toBeChecked();
  expect(localStorage.getItem("meally:checks:tomato-soup")).toBeNull();
});

it("shows not found", async () => {
  renderAt("/recipes/missing");
  expect(await screen.findByText("Recipe not found")).toBeInTheDocument();
});

it("deletes after confirming and returns to the library", async () => {
  renderAt("/recipes/tomato-soup");
  await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === "Delete")!);
  await waitFor(() => expect(deleted).toBe(true));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/recipes"));
  expect(await screen.findByText("Deleted Tomato soup")).toBeInTheDocument();
});

it("recipe page has no axe violations", async () => {
  const { container } = renderAt("/recipes/tomato-soup");
  await screen.findByRole("heading", { name: "Ingredients" });
  expect(await axe(container)).toHaveNoViolations();
});
