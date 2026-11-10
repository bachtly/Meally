import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Feature, FeatureRoute } from "./Feature";
import { FeaturesProvider } from "./FeaturesProvider";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderWith(ui: React.ReactNode, mealPlan: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ features: { "meal-plan": { enabled: mealPlan, locked: false, source: "default", label: "x", description: "y" } } })),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeaturesProvider>{ui}</FeaturesProvider>
    </QueryClientProvider>,
  );
}

it("Feature shows children when on", async () => {
  renderWith(<Feature on="meal-plan" fallback={<p>nope</p>}><p>planner</p></Feature>, true);
  expect(await screen.findByText("planner")).toBeInTheDocument();
});

it("Feature shows fallback when off", async () => {
  renderWith(<Feature on="meal-plan" fallback={<p>nope</p>}><p>planner</p></Feature>, false);
  expect(await screen.findByText("nope")).toBeInTheDocument();
  expect(screen.queryByText("planner")).not.toBeInTheDocument();
});

it("FeatureRoute shows the friendly page when off", async () => {
  renderWith(<FeatureRoute on="meal-plan"><p>planner</p></FeatureRoute>, false);
  expect(await screen.findByText(/turned off on this server/)).toBeInTheDocument();
});

it("FeatureRoute renders children when on", async () => {
  renderWith(<FeatureRoute on="meal-plan"><p>planner</p></FeatureRoute>, true);
  expect(await screen.findByText("planner")).toBeInTheDocument();
});
