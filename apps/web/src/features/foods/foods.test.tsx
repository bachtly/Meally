import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);
let calls: Array<{ method: string; url: string; body: unknown }> = [];

function renderAt(path: string, on = true) {
  const info = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } };
  const foods = [
    { id: "f1", name: "Scallion", pluralName: null, aliases: ["green onion"], aisleId: null, count: 2 },
    { id: "f2", name: "Spring onion", pluralName: null, aliases: [], aisleId: null, count: 0 },
  ];
  const units = [
    { key: "c-scoop", id: "u9", name: "scoop", plural: "scoops", abbreviation: null, kind: "count", factor: null, builtIn: false, count: 0 },
    { key: "cup", name: "cup", plural: "cups", abbreviation: null, kind: "volume", factor: 236, builtIn: true, count: 0 },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ method, url: u, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { "foods-units": info(on) } });
      if (u.includes("/foods") && method === "GET") return Response.json({ items: foods });
      if (u.includes("/units") && method === "GET") return Response.json({ items: units });
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
  calls = [];
  vi.unstubAllGlobals();
});

it("lists foods with counts and aliases, and edits aliases", async () => {
  const user = userEvent.setup();
  const { container } = renderAt("/foods");
  expect(await screen.findByText("Scallion")).toBeInTheDocument();
  expect(screen.getByText("2 recipes")).toBeInTheDocument();
  expect(screen.getByText("green onion")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Add alias for Scallion"), "scallions{Enter}");
  await waitFor(() => expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ aliases: ["green onion", "scallions"] }));
  expect(await axe(container)).toHaveNoViolations();
});

it("merges a food into another", async () => {
  const user = userEvent.setup();
  renderAt("/foods");
  await user.click(await screen.findByRole("button", { name: "Actions for Spring onion" }));
  await user.click(await screen.findByRole("menuitem", { name: /Merge into/ }));
  await user.click(await screen.findByRole("button", { name: "Merge" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/foods/f2/merge"))).toBe(true));
  expect(calls.find((c) => c.url.endsWith("/merge"))?.body).toEqual({ into: "f1" });
});

it("shows built-in units read-only with a badge", async () => {
  const user = userEvent.setup();
  renderAt("/foods");
  await user.click(await screen.findByRole("tab", { name: "Units" }));
  expect(await screen.findByText("Built-in")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Edit scoop" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Edit cup" })).toBeNull();
});

it("keeps the alias field at 16px and 44px tall so iOS does not zoom", async () => {
  renderAt("/foods");
  const field = await screen.findByLabelText("Add alias for Scallion");
  expect(field).toHaveClass("text-base", "min-h-11");
  expect(field).not.toHaveClass("text-sm");
  expect(field).not.toHaveClass("min-h-9");
  expect(field).toHaveAttribute("enterkeyhint", "done");
});
