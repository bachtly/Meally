import { Hono } from "hono";
import { createTokenSchema } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { createToken, listTokens, revokeToken } from "./service.js";

export const tokenRoutes = new Hono<AppEnv>();
tokenRoutes.use("*", requireFeature("api-tokens"), requireAuth, async (c, next) => {
  // A token must not be able to mint or list tokens; management needs a browser session.
  if (c.get("authVia") !== "session") throw new ApiError(403, "session_required", "Manage tokens while signed in to the web app");
  await next();
});
tokenRoutes
  .get("/", async (c) => c.json({ items: await listTokens(c.get("db"), c.get("user").id) }))
  .post("/", async (c) => {
    const parsed = createTokenSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) throw new ApiError(400, "invalid_body", "Give the token a name (up to 60 characters) and a scope of read or write");
    const { token, item } = await createToken(c.get("db"), c.get("user"), parsed.data);
    c.header("Cache-Control", "no-store");
    return c.json({ token, item }, 201);
  })
  .delete("/:id", async (c) => {
    await revokeToken(c.get("db"), c.get("user").id, c.req.param("id"));
    return c.body(null, 204);
  });
