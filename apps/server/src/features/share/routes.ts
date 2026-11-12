import { Hono, type Context } from "hono";
import { createShareSchema, createShareSetSchema, imageSizes, saveShareSchema, type ImageSize } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { clientIp } from "../auth/routes.js";
import { requireFeature } from "../features/middleware.js";
import {
  createCookbookShare,
  createSetShare,
  createShare,
  listAllShares,
  listShares,
  publicImage,
  publicRecipe,
  publicShare,
  publicShareImage,
  publicShareMeta,
  publicShareRecipe,
  revokeShare,
  type ShareFlags,
} from "./service.js";
import { saveShare, shareStatus } from "./save.js";

const body = async (c: Context<AppEnv>) => c.req.json().catch(() => ({}));
const invalid = (msg: string) => new ApiError(400, "invalid_body", msg);
const OPTS_MSG = "expiresInDays must be 1, 7, 30 or null; note is at most 280 characters";

function created(c: Context<AppEnv>, token: string) {
  c.header("Cache-Control", "no-store");
  return c.json({ url: `${c.get("auth").baseOrigin}/s/${token}` }, 201);
}

/** Authenticated: /api/v1/recipes/:slug/shares, /api/v1/cookbooks/:slug/shares and /api/v1/shares (mounted at /api/v1). */
export const shareRoutes = new Hono<AppEnv>();
shareRoutes.use("/recipes/:slug/shares", requireFeature("share-links"), requireAuth);
shareRoutes.use("/cookbooks/:slug/shares", requireFeature("share-links"), requireFeature("cookbooks"), requireAuth);
shareRoutes.use("/shares", requireFeature("share-links"), requireAuth);
shareRoutes.use("/shares/*", requireFeature("share-links"), requireAuth);
shareRoutes
  .post("/recipes/:slug/shares", async (c) => {
    const parsed = createShareSchema.safeParse(await body(c));
    if (!parsed.success) throw invalid(OPTS_MSG);
    return created(c, await createShare(c.get("db"), c.get("userId"), c.get("user"), c.req.param("slug"), parsed.data));
  })
  .get("/recipes/:slug/shares", async (c) => c.json({ items: await listShares(c.get("db"), c.get("userId"), c.req.param("slug")) }))
  .post("/cookbooks/:slug/shares", async (c) => {
    const parsed = createShareSchema.safeParse(await body(c));
    if (!parsed.success) throw invalid(OPTS_MSG);
    return created(c, await createCookbookShare(c.get("db"), c.get("userId"), c.get("user"), c.req.param("slug"), parsed.data));
  })
  .post("/shares", async (c) => {
    const parsed = createShareSetSchema.safeParse(await body(c));
    if (!parsed.success) throw invalid(`recipeSlugs must list 1 to 100 different recipes; ${OPTS_MSG}`);
    return created(c, await createSetShare(c.get("db"), c.get("userId"), c.get("user"), parsed.data));
  })
  .get("/shares", async (c) => c.json({ items: await listAllShares(c.get("db"), c.get("userId")) }))
  // A link someone else sent: what the viewer already has, and saving copies into their recipes.
  .get("/shares/received/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(await shareStatus(c.get("db"), c.get("userId"), c.req.param("token"), await shareFlags(c)));
  })
  .post("/shares/received/:token/save", async (c) => {
    const parsed = saveShareSchema.safeParse(await body(c));
    if (!parsed.success) throw invalid("slugs must list 1 to 10 recipes of the link");
    const f = await c.get("flags").getFeatures();
    const result = await saveShare(
      c.get("db"),
      c.get("platform").images,
      { userId: c.get("userId") },
      c.req.param("token"),
      parsed.data,
      { ...(await shareFlags(c)), foods: f["foods-units"].enabled },
    );
    return c.json(result, 201);
  })
  .delete("/shares/:id", async (c) => {
    await revokeShare(c.get("db"), c.get("userId"), c.req.param("id"));
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

export async function shareFlags(c: Context<AppEnv>): Promise<ShareFlags> {
  const f = await c.get("flags").getFeatures();
  return { scaling: f.scaling.enabled, cookbooks: f.cookbooks.enabled, organizers: f.organizers.enabled, ratings: f.ratings.enabled };
}

async function sendImage(c: Context<AppEnv>, sizeParam: string, img: { imageId: string; userId: string } | null) {
  const size = Number(sizeParam) as ImageSize;
  if (!imageSizes.includes(size) || !img) throw gone();
  const data = await c.get("platform").images.get(img.userId, img.imageId, size);
  if (!data) throw gone();
  c.header("Cache-Control", "private, max-age=3600");
  return c.body(data.bytes as Uint8Array<ArrayBuffer>, 200, { "Content-Type": data.contentType });
}

publicRoutes
  .get("/shares/:token", async (c) => {
    const s = await publicShare(c.get("db"), c.req.param("token"), await shareFlags(c));
    if (!s) throw gone();
    return c.json(s);
  })
  // For link previews (the Pages function and the Node server inject it into /s/* HTML). Doesn't count a view.
  .get("/shares/:token/meta", async (c) => {
    const m = await publicShareMeta(c.get("db"), c.req.param("token"), await shareFlags(c));
    if (!m) throw gone();
    return c.json(m);
  })
  .get("/shares/:token/recipes/:slug", async (c) => {
    const r = await publicShareRecipe(c.get("db"), c.req.param("token"), c.req.param("slug"), await shareFlags(c));
    if (!r) throw gone();
    return c.json(r);
  })
  .get("/shares/:token/recipes/:slug/image/:size", async (c) => {
    const size = c.req.param("size");
    if (!imageSizes.includes(Number(size) as ImageSize)) throw gone();
    return sendImage(c, size, await publicShareImage(c.get("db"), c.req.param("token"), c.req.param("slug"), await shareFlags(c)));
  })
  // F16 single-recipe links, kept so links already sent keep working.
  .get("/recipes/:token", async (c) => {
    const r = await publicRecipe(c.get("db"), c.req.param("token"), (await c.get("flags").getFeatures()).scaling.enabled);
    if (!r) throw gone();
    return c.json(r);
  })
  .get("/recipes/:token/image/:size", async (c) => {
    const size = c.req.param("size");
    if (!imageSizes.includes(Number(size) as ImageSize)) throw gone();
    return sendImage(c, size, await publicImage(c.get("db"), c.req.param("token")));
  });
