import { Hono } from "hono";
import { parseIngredient, z } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";

const bodySchema = z.object({ lines: z.array(z.string().max(1000)).max(500) });

export const ingredientRoutes = new Hono<AppEnv>();
ingredientRoutes.use("*", requireAuth, requireFeature("ingredient-parser"));

ingredientRoutes.post("/parse", async (c) => {
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "invalid_body", "lines: expected an array of strings");
  return c.json({ parsed: parsed.data.lines.map(parseIngredient) });
});
