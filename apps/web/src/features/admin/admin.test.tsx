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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(role: "admin" | "member" = "admin") {
  const state = { cookbooks: true };
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === "PUT" && u.endsWith("/admin/features/cookbooks")) {
        state.cookbooks = JSON.parse(String(init.body)).enabled ?? true;
        calls.push("put");
        return Response.json({});
      }
      if (u.endsWith("/auth/me"))
        return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role } });
      if (u.endsWith("/auth/status")) return Response.json({ needsSetup: false, signupMode: "invite" });
      if (u.endsWith("/admin/info"))
        return Response.json({ version: "0.0.0", nodeVersion: "v22", uptimeSeconds: 90, dbBytes: 2048, imagesBytes: 0, counts: { users: 1, recipes: 0 }, migrations: 14, dataDir: "/data", backupSchedule: { hours: 24, keep: 7 } });
      if (u.endsWith("/admin/features"))
        return Response.json({
          features: [
            { key: "cookbooks", label: "Cookbooks", description: "Saved collections.", enabled: state.cookbooks, locked: false, source: "default", envVar: "MEALLY_FEATURE_COOKBOOKS", dependsOn: [{ key: "organizers", label: "Organisers" }] },
            { key: "ratings", label: "Favourites and ratings", description: "Per-user.", enabled: false, locked: true, source: "env", envVar: "MEALLY_FEATURE_RATINGS", dependsOn: [] },
          ],
        });
      if (u.endsWith("/features"))
        return Response.json({ features: { cookbooks: { enabled: state.cookbooks, locked: false, source: "default", label: "x", description: "y" } } });
      return Response.json({});
    }),
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ["/admin"] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { calls, view };
}

it("toggling a flag updates the nav and shows the locked badge", async () => {
  const user = userEvent.setup();
  const { view } = setup();
  await user.click(await screen.findByRole("tab", { name: "Features" }));
  expect(await screen.findByText("Locked by MEALLY_FEATURE_RATINGS")).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Favourites and ratings" })).toBeDisabled();
  expect(screen.getByText("Needs Organisers")).toBeInTheDocument();
  expect(await screen.findAllByRole("link", { name: "Cookbooks" })).not.toHaveLength(0);
  await user.click(screen.getByRole("switch", { name: "Cookbooks" }));
  await waitFor(() => expect(screen.queryAllByRole("link", { name: "Cookbooks" })).toHaveLength(0));
  expect(await axe(view.container)).toHaveNoViolations();
});

it("redirects non-admins away", async () => {
  setup("member");
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Admin" })).not.toBeInTheDocument());
});
