import fs from "node:fs/promises";
import { Hono } from "hono";
import { createShareSchema, imageSizes, type ImageSize } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { clientIp } from "../auth/routes.js";
import { requireFeature } from "../features/middleware.js";
import { imagePath } from "../recipes/service.js";
import { createShare, listShares, publicImage, publicRecipe, revokeShare } from "./service.js";

/** Authenticated: /api/v1/recipes/:slug/shares and /api/v1/shares/:id (mounted at /api/v1). */
export const shareRoutes = new Hono<AppEnv>();
shareRoutes.use("/recipes/:slug/shares", requireFeature("share-links"), requireAuth);
shareRoutes.use("/shares/*", requireFeature("share-links"), requireAuth);
shareRoutes
  .post("/recipes/:slug/shares", async (c) => {
    const parsed = createShareSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw new ApiError(400, "invalid_body", "expiresInDays must be 1, 7, 30 or null");
    const token = await createShare(c.get("db"), c.get("householdId"), c.get("user").id, c.req.param("slug"), parsed.data.expiresInDays ?? null);
    c.header("Cache-Control", "no-store");
    return c.json({ url: `${c.get("auth").baseOrigin}/s/${token}` }, 201);
  })
  .get("/recipes/:slug/shares", async (c) => c.json({ items: await listShares(c.get("db"), c.get("householdId"), c.req.param("slug")) }))
  .delete("/shares/:id", async (c) => {
    await revokeShare(c.get("db"), c.get("householdId"), c.req.param("id"));
    return c.body(null, 204);
  });

/** Public and unauthenticated; the token is the credential. */
export const publicRoutes = new Hono<AppEnv>();
publicRoutes.use("*", async (c, next) => {
  c.header("X-Robots-Tag", "noindex, nofollow");
  c.header("Referrer-Policy", "no-referrer");
  c.header("Cache-Control", "no-store");
  if (!(await c.get("flags").getFeatures())["share-links"].enabled) throw new ApiError(404, "not_found", "Not found");
  const r = c.get("shareLimiter").hit(clientIp(c));
  if (!r.ok) {
    c.header("Retry-After", String(r.retryAfterSec));
    throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
  }
  await next();
});
const gone = () => new ApiError(404, "not_found", "This link no longer works");
publicRoutes
  .get("/recipes/:token", async (c) => {
    const scaling = (await c.get("flags").getFeatures()).scaling.enabled;
    const r = await publicRecipe(c.get("db"), c.req.param("token"), scaling);
    if (!r) throw gone();
    return c.json(r);
  })
  .get("/recipes/:token/image/:size", async (c) => {
    const size = Number(c.req.param("size")) as ImageSize;
    if (!imageSizes.includes(size)) throw gone();
    const img = await publicImage(c.get("db"), c.req.param("token"));
    if (!img) throw gone();
    const data = await fs.readFile(imagePath(c.get("dataDir"), img.householdId, img.imageId, size)).catch(() => null);
    if (!data) throw gone();
    c.header("Cache-Control", "private, max-age=3600");
    return c.body(new Uint8Array(data), 200, { "Content-Type": "image/webp" });
  });
