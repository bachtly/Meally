import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const me = {
  user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin", householdId: "h1", householdRole: "owner" },
  household: { id: "h1", name: "Home" },
};

function setup(path: string, signedIn: boolean, households = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith("/auth/me")) return signedIn ? Response.json(me) : Response.json({ error: "unauthenticated" }, { status: 401 });
      if (u.endsWith("/auth/status")) return Response.json({ needsSetup: false, signupMode: "invite" });
      if (u.includes("/auth/invite/")) return Response.json({ householdName: "The Smiths", valid: true });
      if (u.endsWith("/household/invites")) return Response.json({ items: [] });
      if (u.endsWith("/household"))
        return Response.json({
          household: me.household,
          members: [
            { id: "u1", name: "Ada", email: "a@example.com", role: "owner", you: true },
            { id: "u2", name: "Bo", email: "b@example.com", role: "member", you: false },
          ],
        });
      if (u.endsWith("/features")) return Response.json({ features: { households: { enabled: households } } });
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
}

it("shows Join <household> on the sign-up page in invite mode", async () => {
  setup("/sign-up?invite=tok", false);
  expect(await screen.findByRole("heading", { name: "Join The Smiths" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /create account and join/i })).toBeInTheDocument();
});

it("lists members with role badges in settings", async () => {
  setup("/settings", true);
  expect(await screen.findByText("Bo")).toBeInTheDocument();
  expect(screen.getByText("Owner")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Invite someone" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Leave household" })).toBeInTheDocument();
});

it("warns before accepting an invite", async () => {
  setup("/invite/tok", true);
  expect(await screen.findByRole("heading", { name: "Join The Smiths" })).toBeInTheDocument();
  expect(screen.getByText(/stay with your old household/)).toBeInTheDocument();
});
