import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { MAX_IMAGE_BYTES, readImageUpload } from "./image-input.js";
import { imageSizes, recipeInputSchema, recipeListQuerySchema, recipeMeInputSchema, z, type ImageSize } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { setMe } from "../ratings/service.js";
import { requireAuth } from "../auth/middleware.js";
import {
  createRecipe,
  deleteRecipe,
  findImage,
  getRecipe,
  listRecipes,
  replaceRecipe,
  setRecipeImage,
} from "./service.js";

export { MAX_IMAGE_BYTES };

function parse<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    const where = i?.path.length ? `${i.path.join(".")}: ` : "";
    throw new ApiError(400, "invalid_body", `${where}${i?.message ?? "Invalid request"}`);
  }
  return parsed.data;
}
const orgOn = async (c: Context<AppEnv>) => (await c.get("flags").getFeatures()).organizers.enabled;
const ratingsOn = async (c: Context<AppEnv>) => (await c.get("flags").getFeatures()).ratings.enabled;
/** Per-request options for the optional features: organisers and per-user ratings. */
const opts = async (c: Context<AppEnv>) => ({ org: await orgOn(c), ratings: await ratingsOn(c), timeline: (await c.get("flags").getFeatures()).timeline.enabled, nutrition: (await c.get("flags").getFeatures()).nutrition.enabled, foods: (await c.get("flags").getFeatures())["foods-units"].enabled, userId: c.get("user").id });
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);

export const recipeRoutes = new Hono<AppEnv>();
recipeRoutes.use("*", requireAuth);

recipeRoutes
  .get("/", async (c) => {
    const raw = { ...c.req.query(), tag: c.req.queries("tag"), category: c.req.queries("category"), tool: c.req.queries("tool") };
    const query = parse(raw, recipeListQuerySchema);
    return c.json(await listRecipes(c.get("db"), c.get("userId"), { ...query, ...(await opts(c)) }));
  })
  .post("/", async (c) => {
    const data = parse(await json(c), recipeInputSchema);
    return c.json(await createRecipe(c.get("db"), c.get("userId"), data, await opts(c)), 201);
  })
  .get("/:slug", async (c) => c.json(await getRecipe(c.get("db"), c.get("userId"), c.req.param("slug"), await opts(c))))
  .put("/:slug", async (c) => {
    const data = parse(await json(c), recipeInputSchema);
    return c.json(await replaceRecipe(c.get("db"), c.get("userId"), c.req.param("slug"), data, await opts(c)));
  })
  .put("/:slug/me", async (c) => {
    if (!(await ratingsOn(c))) throw new ApiError(404, "not_found", "Not found");
    const patch = parse(await json(c), recipeMeInputSchema);
    const recipe = await getRecipe(c.get("db"), c.get("userId"), c.req.param("slug")); // 404 for another user
    return c.json(await setMe(c.get("db"), c.get("user").id, recipe.id, patch));
  })
  .delete("/:slug", async (c) => {
    await deleteRecipe(c.get("db"), c.get("platform").images, c.get("userId"), c.req.param("slug"));
    return c.body(null, 204);
  })
  .post(
    "/:slug/image",
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 512 * 1024,
      onError: () => {
        throw new ApiError(413, "too_large", "Image must be 10 MB or smaller");
      },
    }),
    async (c) => {
      const db = c.get("db");
      const userId = c.get("userId");
      const slug = c.req.param("slug");
      await getRecipe(db, userId, slug); // 404 before touching the upload
      await setRecipeImage(db, c.get("platform").images, userId, slug, await readImageUpload(c));
      return c.json(await getRecipe(db, userId, slug, await opts(c)), 201);
    },
  );

export const imageRoutes = new Hono<AppEnv>();
imageRoutes.use("*", requireAuth);
imageRoutes.get("/:id/:size", async (c) => {
  const size = Number(c.req.param("size")) as ImageSize;
  if (!imageSizes.includes(size)) throw new ApiError(404, "not_found", "Image not found");
  const userId = c.get("userId");
  const id = c.req.param("id");
  const img = await findImage(c.get("db"), userId, id);
  if (!img) throw new ApiError(404, "not_found", "Image not found");
  const data = await c.get("platform").images.get(userId, id, size);
  if (!data) throw new ApiError(404, "not_found", "Image not found");
  // Bytes, not a redirect to a signed Storage URL: the URL would change on every load, so neither the browser nor the
  // service worker could keep the image. An image never changes and ids are never reused, so cache it for a year
  // (per browser only; the service worker keeps it too).
  return c.body(data.bytes as Uint8Array<ArrayBuffer>, 200, {
    "Content-Type": data.contentType,
    "Cache-Control": "private, max-age=31536000, immutable",
  });
});
