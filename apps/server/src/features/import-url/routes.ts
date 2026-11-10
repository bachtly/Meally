import { Hono, type Context } from "hono";
import { recipeInputSchema, z, type RecipeInput } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { createRecipe, setRecipeImage } from "../recipes/service.js";
import { cleanNames } from "../organizers/service.js";
import { extractRecipe } from "./extract.js";

const bodySchema = z.object({ url: z.string().trim().min(1).max(2000) });

export const importRoutes = new Hono<AppEnv>();
importRoutes.use("*", requireAuth, requireFeature("import-url"));
importRoutes.use("*", async (c, next) => {
  const r = c.get("importLimiter").hit(c.get("user").id);
  if (!r.ok) {
    c.header("Retry-After", String(r.retryAfterSec));
    throw new ApiError(429, "rate_limited", "Too many imports. Try again later.");
  }
  await next();
});

async function load(c: Context<AppEnv>) {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "invalid_body", "url: a link is required");
  const page = await c.get("fetcher")(parsed.data.url, { kind: "html" });
  const found = extractRecipe(page.body.toString("utf8"), page.finalUrl);
  if (!found) throw new ApiError(422, "no_recipe_found", "No recipe was found on that page");
  return found;
}

importRoutes.post("/preview", async (c) => c.json(await load(c)));

importRoutes.post("/", async (c) => {
  const found = await load(c);
  const db = c.get("db");
  const org = (await c.get("flags").getFeatures()).organizers.enabled;
  const input = recipeInput(found.recipe);
  if (org) {
    input.tags = cleanNames(found.keywords, 10);
    input.categories = cleanNames(found.categories, 10);
  }
  const recipe = await createRecipe(db, c.get("householdId"), c.get("user").id, input, { org, nutrition: (await c.get("flags").getFeatures()).nutrition.enabled, foods: (await c.get("flags").getFeatures())["foods-units"].enabled });
  if (found.imageUrl) {
    // A missing or bad image never fails the import.
    try {
      const img = await c.get("fetcher")(found.imageUrl, { kind: "image" });
      await setRecipeImage(db, c.get("platform").images, c.get("householdId"), recipe.slug, img.body);
    } catch {
      /* keep the recipe without a photo */
    }
  }
  return c.json({ slug: recipe.slug }, 201);
});

/** Validates the extracted recipe through the same schema as a manual save. */
function recipeInput(r: RecipeInput) {
  const p = recipeInputSchema.safeParse(r);
  if (!p.success) throw new ApiError(422, "no_recipe_found", "The recipe on that page could not be read");
  return p.data;
}
