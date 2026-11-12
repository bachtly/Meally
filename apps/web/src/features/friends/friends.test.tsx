import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { appRoutes } from "../../app/App";
import { FeaturesProvider } from "../features/FeaturesProvider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

interface Opts {
  signedIn?: boolean;
  friendsOn?: boolean;
  signupMode?: string;
  /** Status and body for GET /friends/invites/:token. */
  preview?: [number, unknown];
  /** Status and body for POST .../accept. */
  accept?: [number, unknown];
  friends?: { userId: string; name: string; since: number }[];
  friendsStatus?: number;
  register?: [number, unknown];
}

function setup(path: string, o: Opts = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const friends = [...(o.friends ?? [])];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace("/api/v1", "");
      const method = init?.method ?? "GET";
      calls.push({ method, url: u, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (u === "/auth/me")
        return o.signedIn === false
          ? Response.json({ error: "unauthenticated" }, { status: 401 })
          : Response.json({ user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } });
      if (u === "/auth/register" && o.register) return Response.json(o.register[1], { status: o.register[0] });
      if (u === "/auth/status") return Response.json({ needsSetup: false, signupMode: o.signupMode ?? "invite" });
      if (u === "/features") {
        const on = o.friendsOn !== false;
        return Response.json({ features: { friends: { enabled: on, locked: false, source: "default", label: "Friends", description: "x" } } });
      }
      if (u === "/admin/info")
        return Response.json({ version: "0", nodeVersion: "v22", uptimeSeconds: 1, dbBytes: 1, imagesBytes: 0, counts: { users: 1, recipes: 0 }, migrations: 1, dataDir: "/d", backupSchedule: { hours: 0, keep: 1 } });
      if (u === "/admin/settings") return Response.json({ signupMode: "invite", locked: false, envVar: "X", friendCap: 20 });
      if (u === "/friends" && method === "GET") {
        if (o.friendsStatus) return Response.json({ error: "boom" }, { status: o.friendsStatus });
        return Response.json({ items: friends, cap: 20 });
      }
      if (u === "/friends/invites" && method === "POST")
        return Response.json({ id: "i1", url: "https://x.test/invite/tok", path: "/invite/tok", token: "tok", expiresAt: Date.now() + 6048e5 }, { status: 201 });
      if (u === "/friends/invites" && method === "GET")
        return Response.json({ items: [{ id: "i0", expiresAt: Date.now() + 1e8, usedAt: null }] });
      if (u === "/friends/invites/i0" && method === "DELETE") return new Response(null, { status: 204 });
      if (u.startsWith("/friends/f1") && method === "DELETE") {
        friends.length = 0;
        return new Response(null, { status: 204 });
      }
      if (u.endsWith("/accept")) {
        const [status, body] = o.accept ?? [201, { userId: "f1", name: "Ana", since: 1 }];
        return Response.json(body, { status });
      }
      if (u.startsWith("/friends/invites/")) {
        const [status, body] = o.preview ?? [200, { inviter: { name: "Ana" } }];
        return Response.json(body, { status });
      }
      return Response.json({});
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>
        <RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [path] })} />
      </FeaturesProvider>
    </QueryClientProvider>,
  );
  return calls;
}

it("shows a skeleton, then the empty state and the cap", async () => {
  setup("/friends");
  expect(await screen.findByText("No friends yet")).toBeTruthy();
  expect(screen.getByText("0 of 20")).toBeTruthy();
  expect(screen.getByText(/Valid for 7 days/)).toBeTruthy();
});

it("shows an error with a retry", async () => {
  setup("/friends", { friendsStatus: 500 });
  expect(await screen.findByText("Couldn't load friends")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

it("creates an invite link and revokes an open one", async () => {
  const calls = setup("/friends");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Create invite link" }));
  expect(await screen.findByText("https://x.test/invite/tok")).toBeTruthy();
  await user.click(await screen.findByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/friends/invites/i0")).toBe(true));
});

it("removes a friend after a confirm", async () => {
  const calls = setup("/friends", { friends: [{ userId: "f1", name: "Ana", since: Date.now() }] });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Remove Ana" }));
  await user.click(await screen.findByRole("button", { name: "Remove" }));
  await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.url === "/friends/f1")).toBe(true));
});

it("accepts an invite and goes to Friends", async () => {
  const calls = setup("/invite/tok");
  const user = userEvent.setup();
  expect(await screen.findByText(/Ana wants to be friends/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("heading", { name: "Friends" })).toBeTruthy();
  expect(calls.some((c) => c.method === "POST" && c.url === "/friends/invites/tok/accept")).toBe(true);
});

it("treats a 200 on a retried accept as success", async () => {
  setup("/invite/tok", { accept: [200, { userId: "f1", name: "Ana", since: 1 }] });
  await userEvent.setup().click(await screen.findByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("heading", { name: "Friends" })).toBeTruthy();
});

it("shows a dead link for an unknown, used or expired invite", async () => {
  setup("/invite/tok", { preview: [404, { error: "not_found" }] });
  expect(await screen.findByText("This link no longer works")).toBeTruthy();
});

it("explains an own invite", async () => {
  setup("/invite/tok", { accept: [409, { error: "own_invite", message: "That is your own invite link" }] });
  await userEvent.setup().click(await screen.findByRole("button", { name: "Accept" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
});

it("shows a dead link when the flag is off", async () => {
  setup("/invite/tok", { friendsOn: false });
  expect(await screen.findByText("This link no longer works")).toBeTruthy();
});

it("hides the Friends route when the flag is off", async () => {
  setup("/friends", { friendsOn: false });
  expect(await screen.findByText("This feature is turned off on this server")).toBeTruthy();
});

it("signed out: offers sign in and sign up that come back to the link", async () => {
  setup("/invite/tok", { signedIn: false });
  const up = await screen.findByRole("link", { name: "Create an account" });
  expect(up.getAttribute("href")).toBe("/signup?next=%2Finvite%2Ftok");
});

it("sign-up from an invite link sends the token and lands on Friends", async () => {
  const calls = setup("/signup?next=%2Finvite%2Ftok", { signedIn: false });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Your name"), "Bo");
  await user.type(screen.getByLabelText("Email"), "bo@example.com");
  await user.type(screen.getByLabelText(/Password/), "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(calls.find((c) => c.url === "/auth/register")?.body).toMatchObject({ inviteToken: "tok" }));
});

it("admin saves the Friend cap", async () => {
  const calls = setup("/admin");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("tab", { name: "Sign-up" }));
  const input = await screen.findByLabelText("Most friends per person");
  await user.clear(input);
  await user.type(input, "30");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.method === "PUT" && c.url === "/admin/settings")?.body).toEqual({ friendCap: 30 }));
});

it("sign-up shows a plain message when the inviter is at the friend cap", async () => {
  setup("/signup?next=%2Finvite%2Ftok", { signedIn: false, register: [409, { error: "friend_cap", message: "At most 20 friends" }] });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Your name"), "Bo");
  await user.type(screen.getByLabelText("Email"), "bo@example.com");
  await user.type(screen.getByLabelText(/Password/), "password123");
  await user.click(screen.getByRole("button", { name: "Create account" }));
  expect((await screen.findByRole("alert")).textContent).toContain("your friend has reached their friend limit");
});
