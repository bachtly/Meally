import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it, vi } from "vitest";
import { FeaturesProvider } from "../features/FeaturesProvider";
import { appRoutes } from "../../app/App";

expect.extend(matchers);

const upload = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), uploadImport: (f: File, p: (n: number) => void) => upload(f, p) }));

const job = (over: object = {}) => ({
  id: "j1",
  format: "paprika",
  filename: "all.paprikarecipes",
  status: "running",
  total: 10,
  imported: 3,
  skipped: 1,
  failed: 0,
  errors: [],
  createdAt: Date.now(),
  finishedAt: null,
  ...over,
});
let current = job();

function renderAt(path: string, on = true) {
  const info = { enabled: on, locked: false, source: "default", label: "x", description: "y" };
  const me = {
    user: { id: "u1", email: "a@example.com", name: "Ada", role: "admin" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/auth/me")) return Response.json(me);
      if (u.includes("/features")) return Response.json({ features: { "import-files": info } });
      if (u.includes("/import/jobs/j1")) return Response.json(current);
      if (u.includes("/import/jobs")) return Response.json({ items: [job({ id: "old", status: "done", filename: "old.zip", format: "zip" })] });
      return Response.json({ items: [], nextCursor: null });
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
  upload.mockReset();
});

it("uploads, shows progress, then the summary with errors and a link", async () => {
  current = job({ status: "done", imported: 8, skipped: 1, failed: 1, errors: [{ item: "Bad.html", message: "No recipe found" }], finishedAt: 1 });
  upload.mockImplementation(async (_f: File, onProgress: (n: number) => void) => {
    onProgress(0.5);
    return job();
  });
  const { container } = renderAt("/settings/import");
  expect(await screen.findByRole("heading", { name: "Import recipes" })).toBeInTheDocument();
  expect(await screen.findByText("old.zip")).toBeInTheDocument();
  await userEvent.upload(screen.getByLabelText("Recipe file"), new File(["x"], "all.paprikarecipes"));
  expect(await screen.findByText("Import finished.")).toBeInTheDocument();
  expect(screen.getByText("Imported: 8")).toBeInTheDocument();
  expect(screen.getByText("Skipped (already in your library): 1")).toBeInTheDocument();
  expect(screen.getByText("Bad.html")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View recipes" })).toHaveAttribute("href", "/recipes");
  expect(upload).toHaveBeenCalledTimes(1);
  expect(await axe(container)).toHaveNoViolations();
});

it("shows a running job as a progress bar", async () => {
  current = job();
  upload.mockResolvedValue(job());
  renderAt("/settings/import");
  await userEvent.upload(await screen.findByLabelText("Recipe file"), new File(["x"], "a.zip"));
  const bar = await screen.findByRole("progressbar", { name: "Import progress" });
  expect(bar).toHaveAttribute("aria-valuenow", "40");
});

it("shows upload errors", async () => {
  upload.mockRejectedValue(Object.assign(new Error("That zip has no recipes"), {}));
  renderAt("/settings/import");
  await userEvent.upload(await screen.findByLabelText("Recipe file"), new File(["x"], "a.zip"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  expect(screen.getByRole("alert")).toHaveClass("text-danger");
});

it("is hidden when the flag is off", async () => {
  renderAt("/settings", false);
  await screen.findByRole("heading", { name: "Settings" });
  expect(screen.queryByText("Import recipes")).not.toBeInTheDocument();
});

it("links from settings when on", async () => {
  renderAt("/settings");
  expect(await screen.findByRole("link", { name: /Import from Paprika/ })).toHaveAttribute("href", "/settings/import");
});
