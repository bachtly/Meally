import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const ing = (position: number, raw: string, quantity: number | null, unit: string | null, food: string | null) => ({ position, section: null, raw, quantity, unit, food, note: null });
const recipe = {
  id: "r1", slug: "soup", name: "Soup", description: null, servings: 4, yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null,
  sourceUrl: "https://example.com/soup", notes: null, imageUrl: null, createdAt: 1, updatedAt: 1,
  ingredients: [ing(0, "1 cup milk", 1, "cup", "milk"), ing(1, "1 onion", 1, null, "onion")],
  steps: [{ position: 0, section: null, text: "Warm the milk." }],
};

function renderAt(path: string, printOn = true) {
  const flag = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } };
  vi.stubGlobal("print", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { print: flag(printOn), scaling: flag(true) } });
      if (u.includes("/recipes/soup")) return Response.json(recipe);
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("print page", () => {
  it("renders scaled ingredients, the full source URL and no checkboxes", async () => {
    const { container } = renderAt("/recipes/soup/print?servings=8");
    expect(await screen.findByText("2 cups milk")).toBeInTheDocument();
    expect(screen.getByText("2 onions")).toBeInTheDocument();
    expect(screen.getByText("Serves 8")).toBeInTheDocument();
    expect(screen.getByText("Source: https://example.com/soup")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print again" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("falls back when the flag is off", async () => {
    renderAt("/recipes/soup/print", false);
    expect(await screen.findByText(/isn.t available|turned off|not available/i)).toBeInTheDocument();
    expect(screen.queryByText("Warm the milk.")).toBeNull();
  });
});
