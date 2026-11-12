import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";
import { addDays, startOfWeek, weekDays } from "./dates";

expect.extend(matchers);

const NOW = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const today = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}-${pad(NOW.getDate())}`;
const monday = startOfWeek(today);

const entry = { id: "e1", date: monday, mealType: "dinner", title: null, note: null, position: 0, recipe: { id: "r1", name: "Tomato soup", slug: "tomato-soup", imageUrl: null, totalMinutes: 30 } };
const note = { id: "e2", date: monday, mealType: "lunch", title: "Leftovers", note: null, position: 0, recipe: null };
let calls: { method: string; url: string; body?: string }[] = [];

function renderPlan(opts: { shopping?: boolean } = {}) {
  const on = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
  const features: Record<string, typeof on> = { "meal-plan": on, organizers: on };
  if (opts.shopping !== false) features["shopping-lists"] = on;
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ method: init?.method ?? "GET", url: u, body: init?.body as string | undefined });
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features });
      if (u.includes("/meal-plan/suggest")) return Response.json({ recipe: { id: "r2", name: "Lemon pasta", slug: "lemon-pasta", imageUrl: null, totalMinutes: 20 } });
      if (u.includes("/meal-plan?")) return Response.json({ items: [entry, note] });
      if (u.includes("/meal-plan/ical/token")) return Response.json({ token: "tok", path: "/api/v1/meal-plan/ical" });
      if (u.includes("/meal-plan")) return Response.json({ id: "x" }, { status: init?.method === "POST" ? 201 : 200 });
      if (u.includes("/recipes?")) return Response.json({ items: [{ id: "r2", slug: "lemon-pasta", name: "Lemon pasta", imageUrl: null, totalMinutes: 20, servings: 2, updatedAt: 1 }], nextCursor: null });
      return Response.json({ items: [] });
    }),
  );
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ["/plan"] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("starts weeks on Monday", () => {
  expect(startOfWeek("2026-11-11")).toBe("2026-11-09");
  expect(startOfWeek("2026-11-15")).toBe("2026-11-09");
  expect(weekDays("2026-11-09")).toHaveLength(7);
});

it("renders the week with entries, hides empty slots and navigates", async () => {
  renderPlan();
  const link = await screen.findByRole("link", { name: /Tomato soup/ });
  expect(link).toHaveAttribute("href", "/recipes/tomato-soup");
  expect(screen.getByText("Leftovers")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Breakfast" })).not.toBeInTheDocument();
  expect(screen.getAllByText("Today")).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Next week" }));
  await waitFor(() => expect(calls.some((c) => c.url.includes(`from=${addDays(monday, 7)}`))).toBe(true));
  await userEvent.click(screen.getByRole("button", { name: "This week" }));
  await waitFor(() => expect(calls.filter((c) => c.url.includes(`from=${monday}`)).length).toBeGreaterThan(0));
});

it("adds a recipe from search", async () => {
  renderPlan();
  await screen.findByRole("link", { name: /Tomato soup/ });
  await userEvent.click(screen.getAllByRole("button", { name: /^Add to / })[0]!);
  await userEvent.click(await screen.findByRole("button", { name: "Lemon pasta" }));
  await userEvent.click(screen.getByRole("radio", { name: "Lunch" }));
  await userEvent.click(screen.getByRole("button", { name: "Add to plan" }));
  await waitFor(() => {
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/meal-plan"));
    expect(JSON.parse(post!.body!)).toMatchObject({ recipeId: "r2", mealType: "lunch", date: monday });
  });
});

it("surprise me suggests and accepts", async () => {
  renderPlan();
  await screen.findByRole("link", { name: /Tomato soup/ });
  await userEvent.click(screen.getAllByRole("button", { name: /^Add to / })[0]!);
  await userEvent.click(await screen.findByRole("button", { name: /Surprise me/ }));
  expect(await screen.findByText("Lemon pasta", { selector: "strong" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Another" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Accept" }));
  await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.body?.includes('"recipeId":"r2"'))).toBe(true));
});

it("moves an entry via the menu", async () => {
  renderPlan();
  await userEvent.click(await screen.findByRole("button", { name: "Actions for Tomato soup" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: "Move to day…" }));
  const dlg = await screen.findByRole("dialog");
  await userEvent.selectOptions(within(dlg).getByLabelText("Day"), addDays(monday, 2));
  await userEvent.click(within(dlg).getByRole("button", { name: "Move" }));
  await waitFor(() => {
    const p = calls.find((c) => c.method === "PATCH");
    expect(p!.url).toContain("/meal-plan/e1");
    expect(JSON.parse(p!.body!)).toEqual({ date: addDays(monday, 2), mealType: "dinner" });
  });
});

it("shows the shopping action only when the flag is on", async () => {
  renderPlan();
  expect(await screen.findByRole("button", { name: "Add week to shopping list" })).toBeInTheDocument();
  cleanup();
  renderPlan({ shopping: false });
  await screen.findByRole("link", { name: /Tomato soup/ });
  expect(screen.queryByRole("button", { name: "Add week to shopping list" })).not.toBeInTheDocument();
});

it("shows the calendar link", async () => {
  renderPlan();
  await userEvent.click(await screen.findByRole("button", { name: /Subscribe in calendar/ }));
  expect(await screen.findByDisplayValue(/meal-plan\/ical\?token=tok/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rotate" })).toBeInTheDocument();
});

it("has no axe violations", async () => {
  const { container } = renderPlan();
  await screen.findByRole("link", { name: /Tomato soup/ });
  expect(await axe(container)).toHaveNoViolations();
});

it("keeps the week grid usable on touch (add buttons not hover-only, 44px targets)", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width: 1024px"), media: q, addEventListener: () => {}, removeEventListener: () => {} }));
  renderPlan();
  await screen.findByRole("link", { name: /Tomato soup/ });
  const cellAdd = screen.getAllByRole("button", { name: /^Add Breakfast on /, hidden: true })[0]!;
  // Hover reveal only where the device can hover; always shown on touch.
  expect(cellAdd).toHaveClass("group-hover:block", "any-pointer-coarse:block", "[@media(hover:none)]:block", "min-h-11");
  expect(cellAdd).not.toHaveClass("min-h-8");
  const dayAdd = screen.getAllByRole("button", { name: /^Add to / })[0]!;
  expect(dayAdd).toHaveClass("size-11");
  expect(dayAdd.className).not.toMatch(/size-8/);
  const handle = screen.getByRole("button", { name: "Drag Tomato soup" });
  expect(handle).toHaveClass("touch-manipulation", "any-pointer-coarse:size-11");
});
