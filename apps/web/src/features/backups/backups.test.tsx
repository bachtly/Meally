import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(role: "admin" | "member", backups = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/me"))
        return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role, householdId: "h1", householdRole: "owner" }, household: { id: "h1", name: "Home" } });
      if (u.endsWith("/auth/status")) return Response.json({ needsSetup: false, signupMode: "invite" });
      if (u.endsWith("/features")) return Response.json({ features: { backups: { enabled: backups } } });
      if (u.endsWith("/admin/backups"))
        return Response.json({ items: [{ name: "meally-20261111T120000000Z.zip", size: 2048, createdAt: 1_780_000_000_000 }], schedule: { hours: 24, keep: 7 } });
      return Response.json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ["/settings"] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

it("lets any member download the household export", async () => {
  setup("member");
  expect(await screen.findByRole("heading", { name: "Download my household's recipes" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Markdown" })).toHaveAttribute("href", "/api/v1/export/recipes?format=markdown");
  expect(screen.queryByText("Instance backups")).not.toBeInTheDocument();
});

it("shows the backups list and schedule to admins", async () => {
  setup("admin");
  expect(await screen.findByText("Instance backups")).toBeInTheDocument();
  expect(await screen.findByText(/Automatic backup every 24 h, keeping the newest 7/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create now" })).toBeInTheDocument();
  expect(screen.getAllByRole("link", { name: "Download" })[0]).toHaveAttribute("href", "/api/v1/admin/backups/meally-20261111T120000000Z.zip");
});

it("hides the section when the flag is off", async () => {
  setup("admin", false);
  expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
  expect(screen.queryByText("Export & backups")).not.toBeInTheDocument();
});
