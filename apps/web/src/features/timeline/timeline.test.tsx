import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { relativeTime } from "./api";

expect.extend(matchers);

const recipe = {
  id: "r1", slug: "soup", name: "Soup", description: null, yieldText: null, servings: 4, prepMinutes: null, cookMinutes: null, totalMinutes: null,
  sourceUrl: null, notes: null, imageUrl: null, createdAt: 1, updatedAt: 1, ingredients: [],
  steps: [{ position: 0, section: null, text: "Stir." }],
};
const event = { id: "e1", kind: "made", text: "Tasty", rating: null, imageUrl: "/api/v1/images/i/800", thumbUrl: "/api/v1/images/i/320", userId: "u1", userName: "Ada Lovelace", recipeSlug: "soup", recipeName: "Soup", createdAt: Date.now() - 3 * 3600_000, editedAt: null, canEdit: true, canDelete: true };

function renderAt(path: string, timelineOn = true) {
  const flag = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const posts: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } });
      if (u.includes("/features")) return Response.json({ features: { timeline: flag(timelineOn), "cook-mode": flag(true) } });
      if (init?.method === "POST") {
        posts.push({ url: u, body: JSON.parse(String(init.body)) });
        return Response.json(event, { status: 201 });
      }
      if (u.includes("/timeline")) return Response.json({ items: [event], nextCursor: null });
      if (u.includes("/recipes/soup")) return Response.json(recipe);
      return Response.json({});
    }),
  );
  const view = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return { posts, ...view };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("formats relative time", () => {
  expect(relativeTime(1000, 1000 + 30_000)).toBe("just now");
  expect(relativeTime(0, 5 * 60_000)).toBe("5 min ago");
  expect(relativeTime(0, 3 * 3600_000)).toBe("3 h ago");
});

it("posts a 'made' event from the composer and shows the list", async () => {
  const { posts, container } = renderAt("/recipes/soup");
  expect(await screen.findByText("Tasty")).toBeInTheDocument();
  expect(screen.getByText("Made it")).toBeInTheDocument();
  expect(screen.getByText("AL")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Add a note or comment"), "Great");
  await userEvent.click(screen.getByLabelText("I made this"));
  await userEvent.click(screen.getByRole("button", { name: "Post" }));
  await waitFor(() => expect(posts[0]).toEqual({ url: expect.stringContaining("/recipes/soup/timeline"), body: { kind: "made", text: "Great" } }));
  await userEvent.click(screen.getByRole("button", { name: "Open photo" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
});

it("hides the timeline when the flag is off", async () => {
  renderAt("/recipes/soup", false);
  await screen.findByRole("heading", { name: "Soup" });
  expect(screen.queryByRole("heading", { name: "Timeline" })).not.toBeInTheDocument();
});

it("offers 'Log that I made it' on the cook-mode finish screen", async () => {
  const { posts } = renderAt("/recipes/soup/cook");
  await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
  await userEvent.click(await screen.findByRole("button", { name: "Log that I made it" }));
  await waitFor(() => expect(posts[0]!.body).toEqual({ kind: "made" }));
  expect(await screen.findByLabelText("Optional note")).toBeInTheDocument();
});
