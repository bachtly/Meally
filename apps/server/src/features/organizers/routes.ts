import { Hono, type Context } from "hono";
import { organizerNameSchema, organizerTypes, z, type OrganizerType } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { createOrganizer, deleteOrganizer, listOrganizers, mergeOrganizers, renameOrganizer } from "./service.js";

function body<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new ApiError(400, "invalid_body", `${i?.path.length ? `${i.path.join(".")}: ` : ""}${i?.message ?? "Invalid request"}`);
  }
  return p.data;
}
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);
const nameBody = z.object({ name: organizerNameSchema });
const mergeBody = z.object({ into: z.string().trim().min(1).max(100) });

export const organizerRoutes = new Hono<AppEnv>();
organizerRoutes.use("*", requireAuth, requireFeature("organizers"));
organizerRoutes.use("/:type", async (c, next) => {
  if (!(organizerTypes as readonly string[]).includes(c.req.param("type"))) throw new ApiError(404, "not_found", "Not found");
  await next();
});
organizerRoutes.use("/:type/*", async (c, next) => {
  if (!(organizerTypes as readonly string[]).includes(c.req.param("type"))) throw new ApiError(404, "not_found", "Not found");
  await next();
});
const type = (c: Context<AppEnv>) => c.req.param("type") as OrganizerType;

organizerRoutes
  .get("/:type", async (c) => c.json({ items: await listOrganizers(c.get("db"), type(c), c.get("householdId")) }))
  .post("/:type", async (c) => {
    const { name } = body(await json(c), nameBody);
    return c.json(await createOrganizer(c.get("db"), type(c), c.get("householdId"), name), 201);
  })
  .patch("/:type/:slug", async (c) => {
    const { name } = body(await json(c), nameBody);
    return c.json(await renameOrganizer(c.get("db"), type(c), c.get("householdId"), c.req.param("slug"), name));
  })
  .delete("/:type/:slug", async (c) => {
    await deleteOrganizer(c.get("db"), type(c), c.get("householdId"), c.req.param("slug"));
    return c.body(null, 204);
  })
  .post("/:type/:slug/merge", async (c) => {
    const { into } = body(await json(c), mergeBody);
    return c.json(await mergeOrganizers(c.get("db"), type(c), c.get("householdId"), c.req.param("slug"), into));
  });
