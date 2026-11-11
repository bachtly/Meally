import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HealthPage } from "./HealthPage";

afterEach(() => vi.unstubAllGlobals());

it("shows the server version", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, version: "1.2.3" })));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HealthPage />
    </QueryClientProvider>,
  );
  expect(await screen.findByText(/version 1\.2\.3/)).toBeInTheDocument();
});
