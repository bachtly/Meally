import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { imageSizes, snapCreateSchema, snapListQuerySchema, type ImageSize } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { viewerOf } from "../../lib/access.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { MAX_IMAGE_BYTES, readImageUpload } from "../recipes/image-input.js";
import { createSnap, deleteSnap, getSnap, listFeed, readSnapImage } from "./service.js";

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
      const { snap, created } = await createSnap(c.get("db"), c.get("platform").images, viewerOf(c), parsed.data, () => readImageUpload(c));
      return c.json(snap, created ? 201 : 200);
    },
  )
  .get("/:id", async (c) => c.json(await getSnap(c.get("db"), viewerOf(c), c.req.param("id"))))
  .delete("/:id", async (c) => {
    await deleteSnap(c.get("db"), c.get("platform").images, viewerOf(c), c.req.param("id"));
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
