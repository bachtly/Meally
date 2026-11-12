import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";
import { FeaturesProvider } from "../features/FeaturesProvider";

expect.extend(matchers);

const base = {
  id: "r1", slug: "tomato-soup", name: "Tomato soup", description: null, yieldText: null, servings: 4, prepMinutes: null, cookMinutes: null,
  totalMinutes: 40, sourceUrl: null, notes: null, imageUrl: null, ingredients: [], steps: [], createdAt: 1, updatedAt: 1,
};
let me = { favourite: false, rating: null as number | null };
let puts: unknown[] = [];
let failPut = false;

function renderAt(path: string) {
  const info = { enabled: true, locked: false, source: "default", label: "x", description: "y" };
  const user = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json(user);
      if (u.includes("/features")) return Response.json({ features: { ratings: info } });
      if (u.endsWith("/me") && init?.method === "PUT") {
        if (failPut) return Response.json({ error: "x", message: "boom" }, { status: 500 });
        puts.push(JSON.parse(String(init.body)));
        me = { ...me, ...JSON.parse(String(init.body)) };
        return Response.json(me);
      }
      if (u.includes("/recipes/tomato-soup")) return Response.json({ ...base, me });
      if (u.includes("/recipes?"))
        return Response.json({ items: [{ id: "r1", slug: "tomato-soup", name: "Tomato soup", imageUrl: null, totalMinutes: 20, servings: 2, updatedAt: 1, favourite: me.favourite, rating: me.rating }], nextCursor: null });
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
  me = { favourite: false, rating: null };
  puts = [];
  failPut = false;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("toggles the card heart optimistically and shows the star value", async () => {
  me = { favourite: false, rating: 4 };
  renderAt("/recipes");
  const heart = await screen.findByRole("button", { name: "Favourite Tomato soup" });
  expect(heart).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("Rated 4 of 5")).toBeInTheDocument();
  await userEvent.click(heart);
  expect(heart).toHaveAttribute("aria-pressed", "true"); // before the server answers
  // The fill follows the theme token, so the in-app theme toggle recolours it (Tailwind `dark:` follows the OS only).
  expect(heart).toHaveClass("size-11");
  const icon = heart.querySelector("svg")!;
  expect(icon).toHaveClass("fill-current", "text-danger");
  expect(icon.getAttribute("class")).not.toMatch(/(dark:|text-red-)/);
  await waitFor(() => expect(puts).toEqual([{ favourite: true }]));
});

it("rolls the heart back when saving fails", async () => {
  failPut = true;
  renderAt("/recipes");
  const heart = await screen.findByRole("button", { name: "Favourite Tomato soup" });
  await userEvent.click(heart);
  await waitFor(() => expect(heart).toHaveAttribute("aria-pressed", "false"));
});

it("rates with the keyboard, and clears", async () => {
  const { container } = renderAt("/recipes/tomato-soup");
  const group = await screen.findByRole("radiogroup", { name: "Your rating" });
  const first = screen.getByRole("radio", { name: "1 star" });
  first.focus();
  await userEvent.keyboard("{ArrowRight}");
  await waitFor(() => expect(screen.getByRole("radio", { name: "1 star" })).toHaveAttribute("aria-checked", "true"));
  await userEvent.keyboard("{ArrowRight}");
  await waitFor(() => expect(screen.getByRole("radio", { name: "2 stars" })).toHaveAttribute("aria-checked", "true"));
  expect(puts).toEqual([{ rating: 1 }, { rating: 2 }]);
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  await waitFor(() => expect(puts.at(-1)).toEqual({ rating: null }));
  expect(group).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
});

it("has a Favourites chip and Top rated sort", async () => {
  renderAt("/recipes");
  const chip = await screen.findByRole("button", { name: "Favourites" });
  expect(chip).toHaveAttribute("aria-pressed", "false");
  await userEvent.click(screen.getByRole("button", { name: /Sort/ }));
  expect(await screen.findByRole("menuitem", { name: "Top rated" })).toBeInTheDocument();
});
