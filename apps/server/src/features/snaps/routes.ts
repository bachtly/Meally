import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { imageSizes, reactionParamSchema, snapCreateSchema, snapListQuerySchema, snapPatchSchema, type ImageSize } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { viewerOf } from "../../lib/access.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { MAX_IMAGE_BYTES, readImageUpload } from "../recipes/image-input.js";
import { addReaction, createSnap, deleteSnap, getSnap, getSnapRecipe, listFeed, readSnapImage, relinkSnap, removeReaction, saveSnapRecipe } from "./service.js";

function invalid(issue?: { path: PropertyKey[]; message: string }) {
  return new ApiError(400, "invalid_body", `${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Invalid request"}`);
}

export const snapRoutes = new Hono<AppEnv>();
snapRoutes.use("*", requireAuth, requireFeature("snaps"));

snapRoutes
  .get("/", async (c) => {
    const q = snapListQuerySchema.safeParse(c.req.query());
    if (!q.success) throw invalid(q.error.issues[0]);
    return c.json(await listFeed(c.get("db"), viewerOf(c), q.data));
  })
  .post(
    "/",
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + 512 * 1024,
      onError: () => {
        throw new ApiError(413, "too_large", "Image must be 10 MB or smaller");
      },
    }),
    async (c) => {
      const form = await c.req.parseBody().catch(() => null);
      const text = (k: string) => (typeof form?.[k] === "string" && form[k] !== "" ? (form[k] as string) : undefined);
      const parsed = snapCreateSchema.safeParse({
        clientId: text("clientId"),
        caption: text("caption"),
        dishName: text("dishName"),
        place: text("place"),
        recipeId: text("recipeId"),
      });
      if (!parsed.success) throw invalid(parsed.error.issues[0]);
      const { snap, created, queued } = await createSnap(c.get("db"), c.get("platform").images, viewerOf(c), parsed.data, () => readImageUpload(c));
      if (queued) c.get("push").kick();
      return c.json(snap, created ? 201 : 200);
    },
  )
  .get("/:id", async (c) => c.json(await getSnap(c.get("db"), viewerOf(c), c.req.param("id"))))
  .patch("/:id", async (c) => {
    const body = snapPatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw invalid(body.error.issues[0]);
    return c.json(await relinkSnap(c.get("db"), viewerOf(c), c.req.param("id"), body.data.recipeId));
  })
  .delete("/:id", async (c) => {
    await deleteSnap(c.get("db"), c.get("platform").images, viewerOf(c), c.req.param("id"));
    return c.body(null, 204);
  })
  .get("/:id/recipe", async (c) => c.json(await getSnapRecipe(c.get("db"), viewerOf(c), c.req.param("id"))))
  .post("/:id/recipe/save", async (c) => {
    const foods = (await c.get("flags").getFeatures())["foods-units"].enabled;
    const { slug, created } = await saveSnapRecipe(c.get("db"), c.get("platform").images, viewerOf(c), c.req.param("id"), foods);
    return c.json({ slug }, created ? 201 : 200);
  })
  .put("/:id/reactions/:emoji", async (c) => {
    const p = reactionParamSchema.safeParse({ emoji: c.req.param("emoji") });
    if (!p.success) throw invalid(p.error.issues[0]);
    const snap = await addReaction(c.get("db"), viewerOf(c), c.req.param("id"), p.data.emoji);
    // A first Reaction may have queued a push for the author; send it now rather than on the next tick.
    c.get("push").kick();
    return c.json(snap);
  })
  .delete("/:id/reactions/:emoji", async (c) => {
    const p = reactionParamSchema.safeParse({ emoji: c.req.param("emoji") });
    if (!p.success) throw invalid(p.error.issues[0]);
    await removeReaction(c.get("db"), viewerOf(c), c.req.param("id"), p.data.emoji);
    return c.body(null, 204);
  })
  .get("/:id/images/:imageId/:size", async (c) => {
    const size = Number(c.req.param("size")) as ImageSize;
    if (!imageSizes.includes(size)) throw new ApiError(404, "not_found", "Image not found");
    const data = await readSnapImage(c.get("db"), c.get("platform").images, viewerOf(c), c.req.param("id"), c.req.param("imageId"), size);
    // The URL carries the image id and an id never changes its bytes, so the browser may keep it for a year.
    return c.body(data.bytes as Uint8Array<ArrayBuffer>, 200, {
      "Content-Type": data.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
    });
  });
