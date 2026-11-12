import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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

const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } };

function setup(items: unknown[] = []) {
  const calls: Array<{ url: string; method: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET" });
      if (u.endsWith("/auth/me")) return Response.json(me);
      if (u.endsWith("/features")) return Response.json({ features: { "api-tokens": { enabled: true } } });
      if (u.endsWith("/tokens") && init?.method === "POST") return Response.json({ token: "mly_secretvalue", item: {} }, { status: 201 });
      if (u.endsWith("/tokens")) return Response.json({ items });
      if (u.includes("/tokens/") && init?.method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({});
    }),
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ["/settings"] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { view, calls };
}

it("lists tokens and revokes after confirming", async () => {
  const { calls } = setup([{ id: "t1", name: "Backup script", prefix: "mly_abcd", scope: "read", createdAt: 1, lastUsedAt: null, expiresAt: null }]);
  expect(await screen.findByText("Backup script")).toBeInTheDocument();
  expect(screen.getByText(/never used/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Revoke Backup script" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Revoke" }));
  expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/tokens/t1"))).toBe(true);
});

it("shows the new token once with a warning, and passes axe", async () => {
  setup();
  await userEvent.click(await screen.findByRole("button", { name: "Create token" }));
  const dlg = await screen.findByRole("dialog");
  await userEvent.type(within(dlg).getByLabelText("Name"), "CLI");
  await userEvent.click(within(dlg).getByRole("button", { name: "Create" }));
  const field = await screen.findByDisplayValue("mly_secretvalue");
  // 16px text so iOS does not zoom when the read-only field selects itself on focus; wraps at phone width.
  expect(field).toHaveClass("text-base", "break-all");
  expect(field).not.toHaveClass("text-sm");
  expect(screen.getByRole("alert")).toHaveTextContent(/not be able to see it again/);
  expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
  expect(await axe(screen.getByRole("dialog"))).toHaveNoViolations();
  await userEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByDisplayValue("mly_secretvalue")).not.toBeInTheDocument();
});
