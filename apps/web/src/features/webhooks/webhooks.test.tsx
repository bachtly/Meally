import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function setup(role: "owner" | "member", items: unknown[] = []) {
  const calls: Array<{ url: string; method: string }> = [];
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1", householdRole: role }, household: { id: "h1", name: "Home" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET" });
      if (u.endsWith("/auth/me")) return Response.json(me);
      if (u.endsWith("/features")) return Response.json({ features: { webhooks: { enabled: true } } });
      if (u.endsWith("/webhooks/w1/test")) return Response.json({ ok: true, statusCode: 200, error: null, durationMs: 3 });
      if (u.endsWith("/webhooks/w1") && init?.method === "DELETE") return new Response(null, { status: 204 });
      if (u.endsWith("/webhooks")) return Response.json({ items });
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
  return calls;
}

const hook = { id: "w1", name: "Home server", url: "https://example.com/h", events: ["recipe.created"], enabled: true, dailyAt: "07:00", tz: "UTC", createdAt: 1, lastStatus: 200, lastDeliveryAt: 2, failureCount: 0 };

it("lists webhooks with a status and sends a test", async () => {
  const calls = setup("owner", [hook]);
  expect(await screen.findByText("Home server")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Healthy" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Send test to Home server" }));
  await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/webhooks/w1/test"))).toBe(true));
});

it("shows the time fields only when the daily digest is checked", async () => {
  setup("owner");
  await userEvent.click(await screen.findByRole("button", { name: "Add webhook" }));
  expect(screen.queryByLabelText("Digest time")).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Daily meal plan digest" }));
  expect(screen.getByLabelText("Digest time")).toBeInTheDocument();
});

it("tells members only owners can manage webhooks", async () => {
  const calls = setup("member");
  expect(await screen.findByText(/Only household owners/)).toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith("/webhooks"))).toBe(false);
});

it("deletes only after confirming in the app's dialog, not window.confirm", async () => {
  const native = vi.fn(() => true);
  vi.stubGlobal("confirm", native);
  const calls = setup("owner", [hook]);
  await userEvent.click(await screen.findByRole("button", { name: "Delete Home server" }));
  const dlg = await screen.findByRole("dialog", { name: "Delete Home server?" });
  expect(native).not.toHaveBeenCalled();
  await userEvent.click(within(dlg).getByRole("button", { name: "Cancel" }));
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Delete Home server" }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
  await vi.waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/webhooks/w1"))).toBe(true));
});

it("uses 16px text and URL keyboard hints in the form so iOS does not zoom", async () => {
  setup("owner");
  await userEvent.click(await screen.findByRole("button", { name: "Add webhook" }));
  const url = screen.getByLabelText("URL");
  expect(url).toHaveAttribute("inputmode", "url");
  expect(url).toHaveAttribute("autocapitalize", "none");
  expect(url).toHaveClass("text-base");
});
