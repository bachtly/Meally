import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { timelineListQuerySchema, timelinePatchSchema, timelinePostSchema, z } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { MAX_IMAGE_BYTES, readImageUpload } from "../recipes/image-input.js";
import { findRow } from "../recipes/service.js";
import { addEvent, deleteEvent, listTimeline, setEventImage, updateEvent } from "./service.js";

function parse<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new ApiError(400, "invalid_body", `${i?.path.length ? `${i.path.join(".")}: ` : ""}${i?.message ?? "Invalid request"}`);
  }
  return p.data;
}
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);

/** Mounted at /api/v1: /recipes/:slug/timeline and /timeline/:id. */
export const timelineRoutes = new Hono<AppEnv>();
for (const p of ["/recipes/:slug/timeline", "/recipes/:slug/timeline/*", "/timeline/*"])
  timelineRoutes.use(p, requireAuth, requireFeature("timeline"));

timelineRoutes
  .get("/recipes/:slug/timeline", async (c) => {
    const recipe = await findRow(c.get("db"), c.get("userId"), c.req.param("slug"));
    const q = parse(c.req.query(), timelineListQuerySchema);
    return c.json(await listTimeline(c.get("db"), c.get("userId"), { ...q, recipeId: recipe.id }));
  })
  .post("/recipes/:slug/timeline", async (c) => {
    const body = parse(await json(c), timelinePostSchema);
    const ratings = (await c.get("flags").getFeatures()).ratings.enabled;
    return c.json(await addEvent(c.get("db"), c.get("userId"), c.req.param("slug"), body, { ratings }), 201);
  })
  .patch("/timeline/:id", async (c) =>
    c.json(await updateEvent(c.get("db"), c.get("userId"), c.req.param("id"), parse(await json(c), timelinePatchSchema))),
  )
  .delete("/timeline/:id", async (c) => {
    await deleteEvent(c.get("db"), c.get("platform").images, c.get("userId"), c.req.param("id"));
    return c.body(null, 204);
  })
  .post(
    "/timeline/:id/image",
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 512 * 1024,
      onError: () => {
        throw new ApiError(413, "too_large", "Image must be 10 MB or smaller");
      },
    }),
    async (c) => {
      return c.json(await setEventImage(c.get("db"), c.get("platform").images, c.get("userId"), c.req.param("id"), await readImageUpload(c)), 201);
    },
  );
