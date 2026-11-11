import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within, fireEvent } from "@testing-library/react";
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
  sourceUrl: null,
  notes: null,
  imageUrl: null,
  ingredients: [
    { position: 0, section: null, raw: "1 onion", quantity: 1, unit: null, food: "onion", note: null },
    { position: 1, section: null, raw: "800 g tomatoes", quantity: 800, unit: "g", food: "tomatoes", note: null },
  ],
  steps: [{ position: 0, section: null, text: "Simmer." }],
  createdAt: 1,
  updatedAt: 1,
};

let writes: Array<{ method: string; url: string; body: unknown }> = [];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}
const routes = [{ element: (<><Outlet /><Where /></>), children: appRoutes }];

function renderAt(path: string) {
  const info = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { "import-url": info } });
      if (method !== "GET") {
        writes.push({ method, url: u, body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body });
        return Response.json({ ...recipe, slug: "new-one" }, { status: 201 });
      }
      if (u.includes("/recipes/tomato-soup")) return Response.json(recipe);
      return Response.json({ items: [], nextCursor: null });
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

beforeEach(() => (writes = []));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("creates a recipe with parsed ingredients and goes to its page", async () => {
  renderAt("/recipes/new");
  await userEvent.type(await screen.findByLabelText("Name"), "Pancakes");
  await userEvent.type(screen.getByLabelText("Prep (min)"), "5");
  await userEvent.type(screen.getByLabelText("Cook (min)"), "10");
  expect(screen.getByLabelText("Total (min)")).toHaveValue(15);
  await userEvent.type(screen.getByLabelText("Ingredient 1"), "2 cups flour, sifted{Enter}1 egg");
  expect(screen.getByLabelText("Ingredient 2")).toHaveValue("1 egg");
  await userEvent.type(screen.getByLabelText("Step 1"), "Mix.");
  await userEvent.click(screen.getAllByRole("button", { name: "Save recipe" })[0]!);
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/recipes/new-one"));
  const body = writes[0]!.body as { name: string; totalMinutes: number; ingredients: Array<Record<string, unknown>> };
  expect(writes[0]!.method).toBe("POST");
  expect(body.totalMinutes).toBe(15);
  expect(body.ingredients[0]).toMatchObject({ quantity: 2, unit: "cup", food: "flour", note: "sifted", raw: "2 cups flour, sifted" });
});

it("shows a validation error for a missing name", async () => {
  renderAt("/recipes/new");
  await userEvent.click((await screen.findAllByRole("button", { name: "Save recipe" }))[0]!);
  expect(await screen.findByText("Name is required")).toBeInTheDocument();
  expect(writes).toHaveLength(0);
});

it("pre-fills the form when editing and saves with PUT", async () => {
  renderAt("/recipes/tomato-soup/edit");
  expect(await screen.findByLabelText("Name")).toHaveValue("Tomato soup");
  expect(screen.getByLabelText("Ingredient 2")).toHaveValue("800 g tomatoes");
  expect(screen.getByLabelText("Step 1")).toHaveValue("Simmer.");
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tomato soup 2" } });
  await userEvent.click(screen.getAllByRole("button", { name: "Save recipe" })[0]!);
  await waitFor(() => expect(writes[0]?.method).toBe("PUT"));
});

it("splits pasted multi-line text into rows, headers become sections", async () => {
  renderAt("/recipes/new");
  const first = await screen.findByLabelText("Ingredient 1");
  first.focus();
  await userEvent.paste("For the sauce:\n1 cup milk\n2 eggs");
  expect(screen.getByLabelText("Section name (ingredients)")).toHaveValue("For the sauce");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("1 cup milk");
  expect(screen.getByLabelText("Ingredient 2")).toHaveValue("2 eggs");
});

it("reorders with the keyboard and removes an empty row with Backspace", async () => {
  renderAt("/recipes/tomato-soup/edit");
  const first = await screen.findByLabelText("Ingredient 1");
  first.focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("800 g tomatoes");
  expect(screen.getByLabelText("Ingredient 2")).toHaveValue("1 onion");
  await userEvent.type(screen.getByLabelText("Ingredient 2"), "{Enter}");
  expect(screen.getByLabelText("Ingredient 3")).toHaveFocus();
  await userEvent.keyboard("{Backspace}");
  expect(screen.queryByLabelText("Ingredient 3")).toBeNull();
  expect(screen.getByLabelText("Ingredient 2")).toHaveFocus();
});

it("warns before leaving with unsaved changes", async () => {
  renderAt("/recipes/tomato-soup/edit");
  await userEvent.type(await screen.findByLabelText("Description"), " More.");
  await userEvent.click(screen.getAllByRole("link", { name: "Cancel" })[0]!);
  const dialog = await screen.findByRole("dialog", { name: "Discard your changes?" });
  expect(screen.getByTestId("where")).toHaveTextContent("/recipes/tomato-soup/edit");
  await userEvent.click(within(dialog).getByRole("button", { name: "Discard" }));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/recipes\/tomato-soup$/));
});

it("has no axe violations", async () => {
  const { container } = renderAt("/recipes/tomato-soup/edit");
  await screen.findByLabelText("Name");
  expect(await axe(container)).toHaveNoViolations();
});
