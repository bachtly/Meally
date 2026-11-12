import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  useLocation,
} from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";
import { ownSharePath, sharedUrl } from "./ImportPage";

expect.extend(matchers);

const preview = {
  recipe: {
    name: "Pad thai",
    ingredients: [{ section: null, raw: "200 g noodles" }],
    steps: [{ section: null, text: "Stir fry." }],
  },
  imageUrl: null,
};
let calls: string[] = [];

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(
  path: string,
  opts: { on?: boolean; fail?: { status: number; error: string } } = {},
) {
  const on = opts.on ?? true;
  const info = {
    enabled: on,
    locked: false,
    source: "default",
    label: "x",
    description: "y",
  };
  const me = {
    user: {
      id: "u1",
      email: "a@example.com",
      name: "Ada",
      role: "admin",
    },
  };
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features"))
        return Response.json({ features: { "import-url": info } });
      if (u.includes("/import/url")) {
        calls.push(u);
        if (opts.fail)
          return Response.json(
            { error: opts.fail.error, message: "m" },
            { status: opts.fail.status },
          );
        return u.endsWith("/preview")
          ? Response.json(preview)
          : Response.json({ slug: "pad-thai" }, { status: 201 });
      }
      return Response.json({ items: [], nextCursor: null });
    }),
  );
  const routes = [
    {
      element: (
        <>
          <Outlet />
          <Where />
        </>
      ),
      children: appRoutes,
    },
  ];
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FeaturesProvider>
        <RouterProvider
          router={createMemoryRouter(routes, { initialEntries: [path] })}
        />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("previews then saves and navigates", async () => {
  const { container } = renderAt("/recipes/import");
  await userEvent.type(
    await screen.findByLabelText("Recipe link"),
    "https://example.com/pad-thai",
  );
  await userEvent.click(screen.getByRole("button", { name: "Import" }));
  expect(await screen.findByText("200 g noodles")).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
  await userEvent.click(screen.getByRole("button", { name: "Save recipe" }));
  await waitFor(() =>
    expect(screen.getByTestId("where")).toHaveTextContent("/recipes/pad-thai"),
  );
  expect(calls).toHaveLength(2);
});

it("opens the editor pre-filled", async () => {
  renderAt("/recipes/import?url=https%3A%2F%2Fexample.com%2Fp");
  await userEvent.click(
    await screen.findByRole("button", { name: "Edit before saving" }),
  );
  expect(await screen.findByLabelText("Name")).toHaveValue("Pad thai");
  expect(screen.getByLabelText("Ingredient 1")).toHaveValue("200 g noodles");
});

it("auto-starts from ?url=", async () => {
  renderAt("/recipes/import?url=https%3A%2F%2Fexample.com%2Fp");
  expect(await screen.findByText("Pad thai")).toBeInTheDocument();
  expect(screen.getByLabelText("Recipe link")).toHaveValue(
    "https://example.com/p",
  );
  expect(calls).toHaveLength(1);
});

it("shows a manual link when no recipe is found", async () => {
  renderAt("/recipes/import?url=https%3A%2F%2Fexample.com%2Fp", {
    fail: { status: 422, error: "no_recipe_found" },
  });
  expect(await screen.findByText(/couldn't find a recipe/)).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Create it manually" }),
  ).toHaveAttribute("href", "/recipes/new");
});

it.each([
  ["blocked_url", 400, /can't be imported/],
  ["fetch_failed", 502, /couldn't reach/],
  ["rate_limited", 429, /imported a lot/],
])("shows a friendly %s error", async (error, status, re) => {
  renderAt("/recipes/import?url=https%3A%2F%2Fexample.com%2Fp", {
    fail: { status, error },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(re);
});

it("is hidden when the flag is off", async () => {
  renderAt("/recipes/import", { on: false });
  expect(
    await screen.findByText("This feature is turned off on this server"),
  ).toBeInTheDocument();
});

it("reads a shared url from text", () => {
  expect(
    sharedUrl(new URLSearchParams({ text: "Look https://a.com/x yum" })),
  ).toBe("https://a.com/x");
});

it("recognises this server's own share links, and nothing else", () => {
  const o = "https://meally.example";
  expect(ownSharePath(`${o}/s/tok`, o)).toBe("/s/tok");
  expect(ownSharePath(` ${o}/s/tok/lemon-cake/ `, o)).toBe("/s/tok/lemon-cake");
  expect(ownSharePath(`${o}/s/tok?x=1`, o)).toBe("/s/tok");
  expect(ownSharePath("https://other.example/s/tok", o)).toBeNull();
  expect(ownSharePath(`${o}/recipes/x`, o)).toBeNull();
  expect(ownSharePath("not a url", o)).toBeNull();
});

it("a share link sent to the app (share target or paste) opens the share view instead of importing", async () => {
  renderAt(`/recipes/import?url=${encodeURIComponent(`${location.origin}/s/tok`)}`);
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/s/tok"));
  expect(calls).toEqual([]);
});
