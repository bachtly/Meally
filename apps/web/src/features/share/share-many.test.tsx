import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const on = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
const summary = (n: number, name: string) => ({ id: `s${n}`, slug: `r-${n}`, name, imageUrl: null, totalMinutes: 20, servings: 2, updatedAt: n });
const book = { id: "c1", slug: "weeknight", name: "Weeknight", description: null, kind: "manual", filter: null, coverRecipe: null, covers: [], count: 2, countCapped: false };
const link = (over: object) => ({ id: "l1", kind: "set", title: "Weekend", targetSlug: null, count: 2, sharedBy: "Ada", note: null, createdAt: 1, expiresAt: null, viewCount: 3, ...over });

let calls: { method: string; url: string; body?: string }[] = [];
let links: object[] = [];

function renderAt(path: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? "GET";
      calls.push({ method, url: u, body: init?.body as string | undefined });
      if (u.includes("/auth/me"))
        return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" }, household: { id: "h1", name: "Home" } });
      if (u.includes("/features")) return Response.json({ features: { "share-links": on, cookbooks: on } });
      if (u.endsWith("/cookbooks/weeknight/shares") && method === "POST") return Response.json({ url: "https://meally.test/s/cb" }, { status: 201 });
      if (u.endsWith("/shares") && method === "POST") return Response.json({ url: "https://meally.test/s/tok" }, { status: 201 });
      if (u.match(/\/shares\/l1$/) && method === "DELETE") {
        links = [];
        return new Response(null, { status: 204 });
      }
      if (u.endsWith("/shares")) return Response.json({ items: links });
      if (u.match(/\/cookbooks\/weeknight\/recipes/)) return Response.json({ items: [summary(1, "Lemon pasta")], nextCursor: null });
      if (u.match(/\/cookbooks\/weeknight$/)) return Response.json(book);
      if (u.includes("/recipes?")) return Response.json({ items: [summary(1, "Lemon pasta"), summary(2, "Dal"), summary(3, "Toast")], nextCursor: null });
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

beforeEach(() => {
  calls = [];
  links = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const posted = (path: string) => JSON.parse(calls.find((c) => c.method === "POST" && c.url === `/api/v1${path}`)!.body!);

it("selects several recipes in the library and shares them as one link, with a name and note", async () => {
  const view = renderAt("/recipes");
  await userEvent.click(await screen.findByRole("button", { name: "Select" }));
  expect(screen.getByText("Tap recipes to select them")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Select Lemon pasta" }));
  await userEvent.click(screen.getByRole("button", { name: "Select Toast" }));
  expect(screen.getByRole("button", { name: "Select Toast" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("2 selected")).toBeInTheDocument();
  expect(await axe(view.container)).toHaveNoViolations();
  await userEvent.click(screen.getByRole("button", { name: "Share 2" }));
  const dialog = await screen.findByRole("dialog", { name: "Share 2 recipes" });
  expect(within(dialog).getByText('Shown as "Shared by Ada"')).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText("Name (optional)"), "Weekend");
  await userEvent.type(within(dialog).getByLabelText("Note (optional)"), "Toast first");
  await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));
  expect(await within(dialog).findByDisplayValue("https://meally.test/s/tok")).toBeInTheDocument();
  expect(posted("/shares")).toEqual({ expiresInDays: 7, showName: true, note: "Toast first", recipeSlugs: ["r-1", "r-3"], title: "Weekend" });
  // Closing after a link was made leaves select mode.
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByText("2 selected")).toBeNull());
  expect(screen.getByRole("link", { name: /Lemon pasta/ })).toBeInTheDocument();
});

it("cancelling select mode restores the links, and the share button waits for a selection", async () => {
  renderAt("/recipes");
  await userEvent.click(await screen.findByRole("button", { name: "Select" }));
  expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("link", { name: /Dal/ })).toBeInTheDocument();
});

it("shares a cookbook with the name hidden", async () => {
  renderAt("/cookbooks/weeknight");
  await userEvent.click(await screen.findByRole("button", { name: "Share" }));
  const dialog = await screen.findByRole("dialog", { name: "Share this cookbook" });
  await userEvent.click(within(dialog).getByRole("switch", { name: "Show my name" }));
  expect(within(dialog).getByText("Your name won't be shown")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Create link" }));
  expect(await within(dialog).findByDisplayValue("https://meally.test/s/cb")).toBeInTheDocument();
  expect(posted("/cookbooks/weeknight/shares")).toEqual({ expiresInDays: 7, showName: false, note: null });
});

it("lists every shared link in settings and revokes one", async () => {
  links = [link({}), link({ id: "l2", kind: "cookbook", title: "Weeknight", targetSlug: "weeknight", count: null, sharedBy: null })];
  renderAt("/settings");
  expect(await screen.findByText("Weekend")).toBeInTheDocument();
  expect(screen.getByText(/2 recipes · as Ada · never expires · 3 views/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Weeknight" })).toHaveAttribute("href", "/cookbooks/weeknight");
  expect(screen.getByText(/Cookbook · name hidden/)).toBeInTheDocument();
  await userEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]!);
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url.endsWith("/shares/l1"))).toBe(true));
  expect(await screen.findByText(/No active links/)).toBeInTheDocument();
});
