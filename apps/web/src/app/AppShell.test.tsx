import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { AppRoutes } from "./App";

expect.extend(matchers);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string, shopping = true) {
  const info = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = {
    user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" },
    household: { id: "h1", name: "Home" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/auth/me")
        ? Response.json(me)
        : Response.json({ features: { "meal-plan": info(true), "shopping-lists": info(shopping) } }),
    ),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
        </MemoryRouter>
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

it("renders the shell with nav items", async () => {
  renderAt("/");
  const navs = await screen.findAllByRole("navigation");
  expect(navs).toHaveLength(2);
  expect(await within(navs[0]!).findByRole("link", { name: "Shopping" })).toBeInTheDocument();
  expect(within(navs[0]!).getByRole("link", { name: "Plan" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search and commands" })).toBeInTheDocument();
});

it("hides a nav item when its flag is off", async () => {
  renderAt("/", false);
  const navs = await screen.findAllByRole("navigation");
  await within(navs[0]!).findByRole("link", { name: "Plan" });
  expect(within(navs[0]!).queryByRole("link", { name: "Shopping" })).not.toBeInTheDocument();
  expect(within(navs[1]!).queryByRole("link", { name: "Shopping" })).not.toBeInTheDocument();
});

it("gallery has no axe violations", async () => {
  const { container } = renderAt("/ui");
  await screen.findByRole("heading", { name: "Component gallery" });
  expect(await axe(container)).toHaveNoViolations();
});
