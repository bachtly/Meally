import { Hono } from "hono";
import { pushSubscribeSchema } from "@meally/shared";
import { viewerOf } from "../../lib/access.js";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { subscribe, unsubscribe, vapidKeys } from "./service.js";

export const pushRoutes = new Hono<AppEnv>();
pushRoutes.use("*", requireAuth, requireFeature("push"));

pushRoutes
  /** The VAPID public key the browser subscribes with. 503 when this instance has no usable keys. */
  .get("/key", async (c) => {
    const keys = await vapidKeys(c.get("db"), c.get("env"));
    if (!keys) throw new ApiError(503, "push_unconfigured", "Push notifications aren't set up on this server");
    return c.json({ publicKey: keys.publicKey });
  })
  .post("/subscriptions", async (c) => {
    const body = pushSubscribeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const i = body.error.issues[0];
      throw new ApiError(400, "invalid_body", `${i?.path.join(".") || "body"}: ${i?.message ?? "Invalid request"}`);
    }
    const { id, created } = await subscribe(c.get("db"), viewerOf(c), body.data);
    return c.json({ id }, created ? 201 : 200);
  })
  .delete("/subscriptions/:id", async (c) => {
    await unsubscribe(c.get("db"), viewerOf(c), c.req.param("id"));
    return c.body(null, 204);
  });
