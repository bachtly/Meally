import { ADMIN, expect, nav, openRecipeMenu, test } from "./fixtures";
import { apiPost, cookiesFor, seedRecipe, setupAdmin } from "./server";

test("1. first-run setup creates the admin and lands on the empty library", async ({ browser, fresh }) => {
  const context = await browser.newContext({ baseURL: fresh.url });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Set up Meally" })).toBeVisible();
  await page.getByLabel("Your name").fill(ADMIN.name);
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Create admin account" }).click();
  // Snaps are on by default, so the app opens on the camera; the library is one tap away.
  await expect(page.getByRole("heading", { name: "Snap", exact: true })).toBeVisible();
  await nav(page).getByRole("link", { name: "Recipes" }).click();
  await expect(page).toHaveURL(/\/recipes$/);
  await expect(page.getByRole("heading", { name: "No recipes yet" })).toBeVisible();
  await context.close();
});

test("2. create a recipe from pasted ingredients, find it in the library", async ({ page }, info) => {
  const name = `Pasted Pancakes ${info.project.name}`;
  await page.goto("/recipes/new");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Servings", { exact: true }).fill("4");

  const first = page.getByRole("textbox", { name: "Ingredient 1" });
  await first.focus();
  // A real paste event carrying multi-line text.
  await first.evaluate((el) => {
    const data = new DataTransfer();
    data.setData("text/plain", "2 cups flour\n1 tbsp sugar\n3 eggs");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("textbox", { name: "Ingredient 1" })).toHaveValue("2 cups flour");
  await expect(page.getByRole("textbox", { name: "Ingredient 2" })).toHaveValue("1 tbsp sugar");
  await expect(page.getByRole("textbox", { name: "Ingredient 3" })).toHaveValue("3 eggs");

  await page.getByRole("textbox", { name: "Step 1" }).fill("Whisk everything together.");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("2 cups flour")).toBeVisible();

  await page.goto("/recipes");
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  // The header search box is hidden on phones (they use the command palette), so search through the URL there.
  const search = page.getByLabel("Search recipes").first();
  if (await search.isVisible()) {
    await search.fill("Pasted Pancakes");
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await search.fill("zzzz-nothing");
  } else {
    await page.goto("/recipes?q=Pasted%20Pancakes");
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await page.goto("/recipes?q=zzzz-nothing");
  }
  await expect(page.getByRole("heading", { name: "No results" })).toBeVisible();
});

test("3. scale servings to 2x and switch to metric", async ({ page, recipe }) => {
  await page.goto(`/recipes/${recipe.slug}`);
  const ingredients = page.locator("section[aria-labelledby=ingredients-h]");
  await expect(ingredients).toContainText("2 cups flour");
  await expect(ingredients).toContainText("1 lb butter");

  const servings = page.getByLabel("Servings", { exact: true });
  await servings.fill("8");
  await servings.blur();
  // 4 cups is shown as a quart.
  await expect(ingredients).toContainText("1 quart flour");
  await expect(ingredients).toContainText("2 lb butter");
  await expect(ingredients).toContainText("6 eggs");

  await page.getByRole("radio", { name: "Metric" }).click();
  await expect(ingredients).not.toContainText("quart");
  await expect(ingredients).toContainText(/\d+(\.\d+)? ?k?g butter/);
});

test("4. plan the recipe, add the week to the shopping list, tick an item", async ({ page, recipe }) => {
  await page.goto(`/recipes/${recipe.slug}`);
  await openRecipeMenu(page, "Add to plan");
  await page.getByRole("button", { name: "Add to plan" }).click();
  await expect(page.getByText("Added to your plan")).toBeVisible();

  await nav(page).getByRole("link", { name: "Plan" }).click();
  await expect(page.getByRole("heading", { name: "Plan" })).toBeVisible();
  await expect(page.getByText(recipe.name).first()).toBeVisible();

  // On phones the week actions sit in the "Plan actions" menu.
  const inline = page.getByRole("button", { name: "Add week to shopping list" });
  if (await inline.isVisible()) await inline.click();
  else {
    await page.getByRole("button", { name: "Plan actions" }).click();
    await page.getByRole("menuitem", { name: "Add week to shopping list" }).click();
  }
  const dialog = page.getByRole("dialog", { name: "Add week to shopping list" });
  const add = dialog.getByRole("button", { name: "Add ingredients" });
  await expect(add).toBeVisible();
  const listName = dialog.getByLabel("New list name");
  if (await listName.isVisible()) await listName.fill("Weekly shop");
  await add.click();
  await expect(page.getByText("Added this week's ingredients")).toBeVisible();

  await nav(page).getByRole("link", { name: "Shopping" }).click();
  // The app may open the only list straight away.
  const heading = page.getByRole("heading", { level: 1, name: "Weekly shop" });
  const link = page.getByRole("link", { name: /Weekly shop/ }).first();
  await expect(heading.or(link)).toBeVisible();
  if (await link.isVisible()) await link.click();
  await expect(heading).toBeVisible();
  const flour = page.getByRole("checkbox", { name: /flour/i }).first();
  await expect(flour).not.toBeChecked();
  // Ticked items move to the "In the cart" section.
  await flour.click();
  await expect(page.getByRole("button", { name: /In the cart \(\d+\)/ })).toBeVisible();
});

test("5. turning off the meal-plan flag hides Plan from the nav", async ({ browser, fresh }) => {
  const cookie = await setupAdmin(fresh.url);
  const context = await browser.newContext({ baseURL: fresh.url });
  await context.addCookies(cookiesFor(cookie, fresh.url));
  const page = await context.newPage();
  await page.goto("/recipes");
  await expect(nav(page).getByRole("link", { name: "Plan" })).toBeVisible();

  await page.goto("/admin");
  await page.getByRole("tab", { name: "Features" }).click();
  const toggle = page.getByRole("switch", { name: "Meal planner" });
  await toggle.click();
  await expect(toggle).not.toBeChecked();

  await page.goto("/recipes");
  await expect(nav(page).getByRole("link", { name: "Shopping" })).toBeVisible();
  await expect(nav(page).getByRole("link", { name: "Plan" })).toHaveCount(0);
  await context.close();
});

test("6. a share link opens in a fresh context without a session", async ({ page, recipe, browser, baseURL }) => {
  await page.goto(`/recipes/${recipe.slug}`);
  await openRecipeMenu(page, "Share");
  const dialog = page.getByRole("dialog", { name: "Share this recipe" });
  await dialog.getByRole("button", { name: "Create link" }).click();
  const url = await dialog.getByLabel("Your link (shown only once)").inputValue();
  expect(url).toContain("/s/");

  const anon = await browser.newContext({ baseURL });
  const shared = await anon.newPage();
  await shared.goto(url);
  await expect(shared.getByRole("heading", { level: 1, name: recipe.name })).toBeVisible();
  await expect(shared.getByText("2 cups flour")).toBeVisible();
  await expect(shared.getByRole("button", { name: "Account menu" })).toHaveCount(0);
  await anon.close();
});

test("6b. a newcomer opens a share link, signs up from it, and the recipe saves itself with who shared it", async ({ browser, fresh }) => {
  const h = { "content-type": "application/json", "x-requested-with": "meally" };
  const cookie = await setupAdmin(fresh.url);
  await fetch(`${fresh.url}/api/v1/admin/settings`, { method: "PUT", headers: { ...h, cookie }, body: JSON.stringify({ signupMode: "open" }) });
  const { slug } = await seedRecipe(fresh.url, cookie, "Shared lemon cake");
  const { url } = await apiPost<{ url: string }>(fresh.url, cookie, `/recipes/${slug}/shares`, { note: "Bake this one" });

  const context = await browser.newContext({ baseURL: fresh.url });
  const page = await context.newPage();
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByRole("heading", { level: 1, name: "Shared lemon cake" })).toBeVisible();
  await expect(page.getByText("Ada Admin")).toBeVisible();
  await expect(page.getByText("Bake this one")).toBeVisible();
  await page.getByRole("button", { name: "Save to my recipes" }).click();
  await page.getByRole("link", { name: "Create account and save" }).click();
  await page.getByLabel("Your name").fill("Nina New");
  await page.getByLabel("Email").fill("nina@example.com");
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(/Saved to your recipes/)).toBeVisible();
  await expect(page).toHaveURL(/\/recipes\/shared-lemon-cake/);
  await expect(page.getByRole("heading", { level: 1, name: "Shared lemon cake" })).toBeVisible();
  await expect(page.getByText("Ada Admin")).toBeVisible();
  await expect(page.getByText("2 cups flour")).toBeVisible();
  // Opening the link again knows it's saved.
  await page.goto(url.replace(/^https?:\/\/[^/]+/, ""));
  await expect(page.getByRole("link", { name: "Open my copy" })).toBeVisible();
  await context.close();
});

test("7. cook mode steps with the keyboard", async ({ page, recipe }) => {
  await page.goto(`/recipes/${recipe.slug}`);
  await page.getByRole("link", { name: "Start cooking" }).click();
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByText("Mix the flour and butter.")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await expect(page.getByText("Fold in the eggs.")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("Step 3 of 3")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Step 2 of 3")).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByText("Step 1 of 3")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
});

test("8. the library toolbar fits a 360px phone", async ({ page, recipe }) => {
  void recipe; // a non-empty library shows every toolbar button
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto("/recipes");
  const newRecipe = page.getByRole("button", { name: "New recipe" }).or(page.getByRole("link", { name: "New recipe" }));
  await expect(newRecipe).toBeVisible();
  const box = (await newRecipe.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  // Labels must not wrap onto a second line (that is how the overflow first showed on iOS).
  await expect(page.getByRole("button", { name: "Select recipes" })).toBeVisible();
  for (const b of await page.locator("main h1 + div > *").all()) {
    expect((await b.boundingBox())!.height).toBeLessThanOrEqual(48);
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
});
