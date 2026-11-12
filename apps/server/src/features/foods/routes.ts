import { Hono, type Context } from "hono";
import { foodCreateSchema, foodPatchSchema, unitCreateSchema, unitPatchSchema, z } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { createFood, createUnit, deleteFood, deleteUnit, listFoods, listUnits, mergeFood, updateFood, updateUnit } from "./service.js";

function body<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new ApiError(400, "invalid_body", `${i?.path.length ? `${i.path.join(".")}: ` : ""}${i?.message ?? "Invalid request"}`);
  }
  return p.data;
}
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);
const force = (c: Context<AppEnv>) => ["1", "true", ""].includes(c.req.query("force") ?? "no");
const mergeBody = z.object({ into: z.string().trim().min(1).max(100) });

export const foodRoutes = new Hono<AppEnv>();
foodRoutes.use("*", requireAuth, requireFeature("foods-units"));
foodRoutes
  .get("/", async (c) => c.json({ items: await listFoods(c.get("db"), c.get("userId"), c.req.query("q")) }))
  .post("/", async (c) => c.json(await createFood(c.get("db"), c.get("userId"), body(await json(c), foodCreateSchema)), 201))
  .patch("/:id", async (c) => c.json(await updateFood(c.get("db"), c.get("userId"), c.req.param("id"), body(await json(c), foodPatchSchema))))
  .delete("/:id", async (c) => {
    await deleteFood(c.get("db"), c.get("userId"), c.req.param("id"), force(c));
    return c.body(null, 204);
  })
  .post("/:id/merge", async (c) => {
    const { into } = body(await json(c), mergeBody);
    return c.json(await mergeFood(c.get("db"), c.get("userId"), c.req.param("id"), into));
  });

export const unitRoutes = new Hono<AppEnv>();
unitRoutes.use("*", requireAuth, requireFeature("foods-units"));
unitRoutes
  .get("/", async (c) => c.json({ items: await listUnits(c.get("db"), c.get("userId")) }))
  .post("/", async (c) => c.json(await createUnit(c.get("db"), c.get("userId"), body(await json(c), unitCreateSchema)), 201))
  .patch("/:id", async (c) => c.json(await updateUnit(c.get("db"), c.get("userId"), c.req.param("id"), body(await json(c), unitPatchSchema))))
  .delete("/:id", async (c) => {
    await deleteUnit(c.get("db"), c.get("userId"), c.req.param("id"), force(c));
    return c.body(null, 204);
  });
