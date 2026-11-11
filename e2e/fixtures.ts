import { test as base, expect, type Page } from "@playwright/test";
import { ADMIN, cookiesFor, seedRecipe, startServer, type RunningServer } from "./server";

interface Fixtures {
  /** The shared server, with an admin already created. */
  app: { url: string; cookie: string };
  /** A recipe seeded through the API with a name unique to this test. */
  recipe: { name: string; slug: string };
  /** A private, empty server for tests that change global state. */
  fresh: RunningServer;
}

export const test = base.extend<Fixtures>({
  baseURL: async ({}, use) => use(process.env.E2E_BASE_URL!),
  app: async ({}, use) => use({ url: process.env.E2E_BASE_URL!, cookie: process.env.E2E_COOKIE! }),
  // Pages are signed in as the admin of the shared server.
  context: async ({ context, baseURL }, use) => {
    await context.addCookies(cookiesFor(process.env.E2E_COOKIE!, baseURL!));
    await use(context);
  },
  recipe: async ({ app }, use, info) => {
    const name = `Lemon Cake ${info.project.name} ${Date.now() % 1_000_000}`;
    const { slug } = await seedRecipe(app.url, app.cookie, name);
    await use({ name, slug });
  },
  fresh: async ({}, use) => {
    const server = await startServer();
    await use(server);
    await server.stop();
  },
});

export { expect, ADMIN };

/** Phones show Plan, Shopping and More in the tab bar; desktop shows them in the sidebar. */
export function nav(page: Page) {
  const desktop = (page.viewportSize()?.width ?? 0) >= 1024;
  return page.getByRole("navigation", { name: desktop ? "Sidebar" : "Tab bar" });
}

export async function openRecipeMenu(page: Page, item: string) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: item }).click();
}
