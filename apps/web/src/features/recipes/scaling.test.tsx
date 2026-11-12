import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const ing = (position: number, raw: string, quantity: number | null, unit: string | null, food: string | null) => ({ position, section: null, raw, quantity, unit, food, note: null });
const recipe = {
  id: "r1", slug: "soup", name: "Soup", description: null, servings: 4, yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null,
  sourceUrl: null, notes: null, imageUrl: null, createdAt: 1, updatedAt: 1,
  ingredients: [ing(0, "1 cup milk", 1, "cup", "milk"), ing(1, "2 cloves garlic", 2, "clove", "garlic"), ing(2, "salt to taste", null, null, null)],
  steps: [{ position: 0, section: null, text: "Add 1 cup milk." }],
};

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.search}</div>;
}

function renderAt(path: string, scaling = true) {
  const flag = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { scaling: flag(scaling) } });
      if (u.includes("/recipes/soup")) return Response.json(recipe);
      return Response.json({});
    }),
  );
  const routes = [{ element: (<><Outlet /><Where /></>), children: appRoutes }];
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("stepper scales ingredients, updates the URL and resets", async () => {
  renderAt("/recipes/soup");
  await screen.findByRole("checkbox", { name: "1 cup milk" });
  expect(screen.queryByRole("button", { name: "Reset servings" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "More servings" }));
  expect(screen.getByLabelText("Servings")).toHaveValue("5");
  expect(screen.getByRole("checkbox", { name: "1¼ cups milk" })).toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent("?servings=5");
  expect(screen.getByText("Quantities in steps aren't scaled.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Reset servings" }));
  expect(screen.getByRole("checkbox", { name: "1 cup milk" })).toBeInTheDocument();
  expect(screen.getByTestId("where")).toHaveTextContent(/^$/);
});

it("typing a number sets the servings", async () => {
  renderAt("/recipes/soup");
  const input = await screen.findByLabelText("Servings");
  await userEvent.clear(input);
  await userEvent.type(input, "8");
  expect(screen.getByRole("checkbox", { name: "2 cups milk" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "4 cloves garlic" })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "salt to taste" })).toBeInTheDocument();
});

it("reads servings and units from the URL and keeps them when toggling", async () => {
  renderAt("/recipes/soup?servings=6&units=metric");
  expect(await screen.findByRole("checkbox", { name: "1.42 l milk".replace("1.42 l", "355 ml") })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Metric" })).toBeChecked();
  await userEvent.click(screen.getByRole("radio", { name: "US" }));
  expect(screen.getByTestId("where")).toHaveTextContent("servings=6");
  expect(screen.getByTestId("where")).toHaveTextContent("units=us");
  expect(screen.getByRole("checkbox", { name: "1½ cups milk" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("radio", { name: "Original" }));
  expect(screen.getByTestId("where")).not.toHaveTextContent("units");
});

it("hides the controls and ignores the URL when the flag is off", async () => {
  renderAt("/recipes/soup?servings=6&units=metric", false);
  await screen.findByRole("checkbox", { name: "1 cup milk" });
  expect(screen.queryByLabelText("Servings")).toBeNull();
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(screen.queryByText(/aren't scaled/)).toBeNull();
});

it("has no axe violations with the controls", async () => {
  const { container } = renderAt("/recipes/soup?servings=6");
  await screen.findByLabelText("Servings");
  expect(await axe(container)).toHaveNoViolations();
});
