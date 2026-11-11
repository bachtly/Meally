import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

const me = {
  user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1" },
  household: { id: "h1", name: "Home" },
};

function setup(path: string, signedIn = false) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/auth/me")) return signedIn ? Response.json(me) : Response.json({ error: "unauthenticated" }, { status: 401 });
    if (u.endsWith("/auth/status")) return Response.json({ needsSetup: false, signupMode: "open" });
    if (u.endsWith("/auth/login")) {
      signedIn = true;
      return Response.json(me);
    }
    if (u.endsWith("/auth/logout")) return Response.json({ ok: true, init });
    return Response.json({ features: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  );
  return fetchMock;
}

it("redirects unauthenticated users to sign in", async () => {
  setup("/plan");
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
});

it("validates the sign-in form before posting", async () => {
  const fetchMock = setup("/signin");
  await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/auth/login"))).toBe(false);
});

it("signs in and lands in the app, sending X-Requested-With", async () => {
  const fetchMock = setup("/signin");
  await userEvent.type(await screen.findByLabelText("Email"), "a@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "correct horse");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
  const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/auth/login"))!;
  expect(new Headers(call[1]?.headers).get("x-requested-with")).toBe("meally");
});

it("shows the user menu with name and sign out", async () => {
  setup("/", true);
  await userEvent.click(await screen.findByRole("button", { name: "Account menu" }));
  expect(await screen.findByText("Ada")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("menuitem", { name: /sign out/i }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument());
});

it("renders from the stored session while /auth/me is still pending", async () => {
  localStorage.setItem("meally:session", JSON.stringify(me));
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => (String(url).endsWith("/auth/me") ? new Promise<Response>(() => {}) : Promise.resolve(Response.json({ features: {}, items: [] })))),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ["/plan"] })} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("button", { name: "Account menu" })).toBeInTheDocument();
});

it("drops a stored session the server rejects and goes to sign in", async () => {
  localStorage.setItem("meally:session", JSON.stringify(me));
  setup("/plan");
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  expect(localStorage.getItem("meally:session")).toBeNull();
});

it("shows a retry state, not sign in, when the session check fails online", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => (String(url).endsWith("/auth/me") ? Promise.reject(new TypeError("Load failed")) : Promise.resolve(Response.json({ features: {} })))));
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: ["/plan"] })} />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("heading", { name: "Can't reach Meally" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

it("stores the session after signing in", async () => {
  setup("/", true);
  await screen.findByRole("button", { name: "Account menu" });
  expect(JSON.parse(localStorage.getItem("meally:session")!)).toMatchObject({ user: { name: "Ada" } });
});
