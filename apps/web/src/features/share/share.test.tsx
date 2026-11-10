import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const recipe = {
  name: "Soup", description: "Warm.", yieldText: null, servings: 4, prepMinutes: 5, cookMinutes: 10, totalMinutes: 15, sourceUrl: null, notes: null,
  imageUrl: null, scaling: true,
  ingredients: [{ position: 0, section: null, raw: "1 cup milk", quantity: 1, unit: "cup", food: "milk", note: null }],
  steps: [{ position: 0, section: null, text: "Stir." }],
};

function renderAt(path: string, status = 200) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/auth/me")) return Response.json({ error: "unauthenticated" }, { status: 401 });
      if (u.includes("/public/recipes/")) return status === 200 ? Response.json(recipe) : Response.json({ error: "not_found" }, { status });
      return Response.json({ features: {} });
    }),
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { view, calls };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders the public recipe without a session, scales servings, and passes axe", async () => {
  const { view } = renderAt("/s/abc");
  expect(await screen.findByRole("heading", { name: "Soup" })).toBeInTheDocument();
  expect(screen.getByText("1 cup milk")).toBeInTheDocument();
  expect(screen.getByText("Shared with Meally")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "More servings" }));
  expect(screen.getByText("1¼ cups milk")).toBeInTheDocument();
  expect(await axe(view.container)).toHaveNoViolations();
});

it("shows a friendly state when the link no longer works", async () => {
  const { view } = renderAt("/s/dead", 404);
  expect(await screen.findByText("This link no longer works")).toBeInTheDocument();
  expect(await axe(view.container)).toHaveNoViolations();
});
