import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/features/FeaturesProvider";
import { appRoutes } from "./App";
import html from "../../index.html?raw";

expect.extend(matchers);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderAt(path: string, shopping = true) {
  const info = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = {
    user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" },
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
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

it("renders the shell with nav items", async () => {
  renderAt("/recipes");
  const navs = await screen.findAllByRole("navigation");
  expect(navs).toHaveLength(2);
  expect(await within(navs[0]!).findByRole("link", { name: "Shopping" })).toBeInTheDocument();
  expect(within(navs[0]!).getByRole("link", { name: "Plan" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search and commands" })).toBeInTheDocument();
});

it("hides a nav item when its flag is off", async () => {
  renderAt("/recipes", false);
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

it("keeps the header and tab bar clear of device safe areas", async () => {
  const observed: Element[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private cb: () => void) {}
      observe(el: Element) {
        observed.push(el);
        this.cb();
      }
      disconnect() {}
    },
  );
  renderAt("/recipes");
  const tabBar = await screen.findByRole("navigation", { name: "Tab bar" });
  expect(tabBar.className).toContain("pb-(--sab)");
  const header = document.querySelector("header")!;
  expect(header.className).toContain("var(--sat)");
  expect(observed).toContain(header);
  // The sticky shopping form reads the header's measured height.
  expect(document.documentElement.style.getPropertyValue("--header-h")).toMatch(/px$/);
});

it("scrolls inside the shell so the tab bar never uses position: fixed (iOS 26 drift)", async () => {
  renderAt("/recipes");
  const tabBar = await screen.findByRole("navigation", { name: "Tab bar" });
  expect(tabBar.className).not.toMatch(/fixed/);
  const scroller = document.querySelector("[data-scroll-root]")!;
  expect(scroller.className).toContain("overflow-y-auto");
  expect(scroller.contains(document.querySelector("main"))).toBe(true);
  expect(scroller.contains(tabBar)).toBe(false);
});

it("opts into safe-area insets in the viewport meta", () => {
  expect(html).toMatch(/name="viewport" content="[^"]*viewport-fit=cover/);
  expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/);
});
