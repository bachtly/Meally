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

function renderImport(opts: { configured: boolean; role?: string; aiOn?: boolean; path?: string }) {
  const info = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/me"))
        return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: opts.role ?? "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } });
      if (u.includes("/features")) return Response.json({ features: { ai: info(opts.aiOn ?? true), "import-url": info(true) } });
      if (u.includes("/ai/status")) return Response.json(opts.configured ? { configured: true, provider: "anthropic", model: "m" } : { configured: false });
      if (u.includes("/ai/recipe-from-text")) {
        bodies.push(JSON.parse(String(init?.body)));
        return Response.json({ recipe: { name: "Soup", ingredients: [{ raw: "2 cups stock" }], steps: [{ text: "Heat." }] }, imageUrl: null });
      }
      return Response.json({ items: [], nextCursor: null });
    }),
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [opts.path ?? "/recipes/import"] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { ...view, bodies };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("reads text into a preview, with a privacy note and no axe violations", async () => {
  const { container, bodies } = renderImport({ configured: true });
  await userEvent.click(await screen.findByRole("tab", { name: "From text" }));
  expect(await screen.findByText(/sent to Anthropic configured by your server admin/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Recipe text"), "soup: 2 cups stock");
  await userEvent.click(screen.getByRole("button", { name: "Read recipe" }));
  expect(await screen.findByText("Soup")).toBeInTheDocument();
  expect(bodies).toEqual([{ text: "soup: 2 cups stock" }]);
  expect(await axe(container)).toHaveNoViolations();
  await userEvent.click(screen.getByRole("button", { name: "Edit before saving" }));
  expect(await screen.findByDisplayValue("Soup")).toBeInTheDocument();
});

it("explains missing configuration to admins", async () => {
  renderImport({ configured: false });
  await userEvent.click(await screen.findByRole("tab", { name: "From photos" }));
  expect(await screen.findByText(/MEALLY_AI_PROVIDER/)).toBeInTheDocument();
});

it("hides the AI tabs when the flag is off", async () => {
  renderImport({ configured: true, aiOn: false });
  await screen.findByLabelText("Recipe link");
  expect(screen.queryByRole("tab", { name: "From text" })).toBeNull();
});

it("opens the tab named by ?from=", async () => {
  renderImport({ configured: true, path: "/recipes/import?from=text" });
  expect(await screen.findByRole("tab", { name: "From text", selected: true })).toBeInTheDocument();
  expect(await screen.findByLabelText("Recipe text")).toBeInTheDocument();
});
