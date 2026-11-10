import { Hono, type Context } from "hono";
import { cookbookInputSchema, cookbookPatchSchema, z } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import {
  addToCookbook,
  cookbookRecipesPage,
  cookbooksWithRecipe,
  createCookbook,
  deleteCookbook,
  getCookbook,
  listCookbooks,
  removeFromCookbook,
  reorderCookbookRecipes,
  reorderCookbooks,
  updateCookbook,
} from "./service.js";

function parse<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new ApiError(400, "invalid_body", `${i?.path.length ? `${i.path.join(".")}: ` : ""}${i?.message ?? "Invalid request"}`);
  }
  return p.data;
}
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);
const opts = async (c: Context<AppEnv>) => {
  const f = await c.get("flags").getFeatures();
  return { org: f.organizers.enabled, ratings: f.ratings.enabled, userId: c.get("user").id };
};
const slugBody = z.object({ slug: z.string().trim().min(1).max(100) });
const orderBody = z.object({ slugs: z.array(z.string().trim().min(1).max(100)).max(1000) });
const pageQuery = z.object({ cursor: z.string().max(500).optional(), limit: z.coerce.number().int().min(1).max(100).default(24) });

export const cookbookRoutes = new Hono<AppEnv>();
cookbookRoutes.use("*", requireAuth, requireFeature("cookbooks"));

cookbookRoutes
  .get("/", async (c) => c.json({ items: await listCookbooks(c.get("db"), c.get("householdId"), await opts(c)) }))
  .post("/", async (c) =>
    c.json(await createCookbook(c.get("db"), c.get("householdId"), parse(await json(c), cookbookInputSchema), await opts(c)), 201),
  )
  .put("/order", async (c) => {
    await reorderCookbooks(c.get("db"), c.get("householdId"), parse(await json(c), orderBody).slugs);
    return c.body(null, 204);
  })
  .get("/containing/:recipeSlug", async (c) =>
    c.json({ items: await cookbooksWithRecipe(c.get("db"), c.get("householdId"), c.req.param("recipeSlug")) }),
  )
  .get("/:slug", async (c) => c.json(await getCookbook(c.get("db"), c.get("householdId"), c.req.param("slug"), await opts(c))))
  .put("/:slug", async (c) =>
    c.json(
      await updateCookbook(c.get("db"), c.get("householdId"), c.req.param("slug"), parse(await json(c), cookbookPatchSchema), await opts(c)),
    ),
  )
  .delete("/:slug", async (c) => {
    await deleteCookbook(c.get("db"), c.get("householdId"), c.req.param("slug"));
    return c.body(null, 204);
  })
  .get("/:slug/recipes", async (c) =>
    c.json(await cookbookRecipesPage(c.get("db"), c.get("householdId"), c.req.param("slug"), parse(c.req.query(), pageQuery), await opts(c))),
  )
  .post("/:slug/recipes", async (c) => {
    await addToCookbook(c.get("db"), c.get("householdId"), c.req.param("slug"), parse(await json(c), slugBody).slug);
    return c.body(null, 204);
  })
  .delete("/:slug/recipes/:recipeSlug", async (c) => {
    await removeFromCookbook(c.get("db"), c.get("householdId"), c.req.param("slug"), c.req.param("recipeSlug"));
    return c.body(null, 204);
  })
  .put("/:slug/order", async (c) => {
    await reorderCookbookRecipes(c.get("db"), c.get("householdId"), c.req.param("slug"), parse(await json(c), orderBody).slugs);
    return c.body(null, 204);
  });
