import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";
import { ingredientsForStep } from "./helpers";
import { useTimers } from "./useTimers";

expect.extend(matchers);

const ing = (position: number, raw: string, quantity: number | null, unit: string | null, food: string | null) => ({ position, section: null, raw, quantity, unit, food, note: null });
const recipe = {
  id: "r1", slug: "soup", name: "Soup", description: null, servings: 4, yieldText: null, prepMinutes: null, cookMinutes: null, totalMinutes: null,
  sourceUrl: null, notes: null, imageUrl: null, createdAt: 1, updatedAt: 1,
  ingredients: [ing(0, "1 cup milk", 1, "cup", "milk"), ing(1, "2 cloves garlic", 2, "clove", "garlic"), ing(2, "salt", null, null, "salt")],
  steps: [
    { position: 0, section: "Base", text: "Warm the milk." },
    { position: 1, section: "Base", text: "Simmer for 10 minutes with garlic." },
    { position: 2, section: "Finish", text: "Season and serve." },
  ],
};

function renderAt(path: string, cookOn = true) {
  const flag = (enabled: boolean) => ({ enabled, locked: false, source: "default", label: "x", description: "y" });
  const me = { user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { "cook-mode": flag(cookOn), scaling: flag(true) } });
      if (u.includes("/recipes/soup")) return Response.json(recipe);
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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("cook page", () => {
  it("steps with buttons and keys, shows sections and finish", async () => {
    const user = userEvent.setup();
    const { container } = renderAt("/recipes/soup/cook");
    expect(await screen.findByText("Warm the milk.")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("list", { name: "Ingredients for this step" })).toHaveTextContent("1 cup milk");
    expect(await axe(container)).toHaveNoViolations();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("Step 3 of 3")).toBeInTheDocument();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(screen.getByRole("heading", { name: "All done" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Done" })).toHaveAttribute("href", "/recipes/soup");
  });

  it("keeps servings and units on the exit link", async () => {
    renderAt("/recipes/soup/cook?servings=8&units=us");
    await screen.findByText("Warm the milk.");
    expect(screen.getByRole("link", { name: "Exit cook mode" })).toHaveAttribute("href", "/recipes/soup?servings=8&units=us");
  });

  it("shares check state with the recipe page key", async () => {
    const user = userEvent.setup();
    renderAt("/recipes/soup/cook");
    await screen.findByText("Warm the milk.");
    await user.click(screen.getByRole("button", { name: "Ingredients" }));
    await user.click(await screen.findByRole("checkbox", { name: /milk/ }));
    expect(JSON.parse(localStorage.getItem("meally:checks:soup")!).ingredients).toEqual([0]);
  });

  it("shows the manual fallback when wake lock is unsupported", async () => {
    renderAt("/recipes/soup/cook");
    expect(await screen.findByText("Keep your screen on manually")).toBeInTheDocument();
  });

  it("requests a wake lock when supported", async () => {
    const release = vi.fn(async () => {});
    const request = vi.fn(async () => ({ released: false, release, addEventListener: vi.fn() }));
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    try {
      renderAt("/recipes/soup/cook");
      expect(await screen.findByText("Screen stays on")).toBeInTheDocument();
      expect(request).toHaveBeenCalledWith("screen");
    } finally {
      delete (navigator as unknown as { wakeLock?: unknown }).wakeLock;
    }
  });

  it("starts a timer from a chip and keeps it across steps", async () => {
    const user = userEvent.setup();
    renderAt("/recipes/soup/cook");
    await screen.findByText("Warm the milk.");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Start 10 minutes timer" }));
    expect(screen.getByRole("list", { name: "Running timers" })).toHaveTextContent("10:00");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("list", { name: "Running timers" })).toBeInTheDocument();
  });

  it("is off when the flag is off", async () => {
    renderAt("/recipes/soup/cook", false);
    expect(await screen.findByRole("alert")).toHaveTextContent(/turned off/);
  });
});

describe("useTimers", () => {
  it("counts down, fires once, and restores after a reload", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const done = vi.fn();
    const { result, unmount } = renderHook(() => useTimers("soup", done));
    act(() => result.current.start("2 min", 120));
    expect(result.current.timers).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(done).not.toHaveBeenCalled();

    unmount();
    const again = renderHook(() => useTimers("soup", done));
    expect(again.result.current.timers).toHaveLength(1);
    act(() => void vi.advanceTimersByTime(61_000));
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![0].label).toBe("2 min");
    expect(again.result.current.timers).toHaveLength(0);
    expect(localStorage.getItem("meally:timers:soup")).toBeNull();
  });

  it("runs several timers and cancels one", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTimers("soup", vi.fn()));
    act(() => {
      result.current.start("a", 30);
      result.current.start("b", 60);
    });
    expect(result.current.timers).toHaveLength(2);
    act(() => result.current.cancel(result.current.timers[0]!.id));
    expect(result.current.timers.map((t) => t.label)).toEqual(["b"]);
  });
});

describe("ingredientsForStep", () => {
  it("matches whole words and plurals", () => {
    const list = [{ food: "tomato" }, { food: "oil" }, { food: "egg" }, { food: null }];
    expect(ingredientsForStep("Chop the tomatoes and add oil", list)).toEqual([0, 1]);
    expect(ingredientsForStep("Boil water", list)).toEqual([]);
    expect(ingredientsForStep("Coil the hose", list)).toEqual([]);
  });
});
