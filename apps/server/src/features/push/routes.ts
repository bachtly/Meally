import { Hono } from "hono";
import { pushSubscribeSchema } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";

function invalid(issue?: { path: PropertyKey[]; message: string }) {
  return new ApiError(400, "invalid_body", `${issue?.path.length ? `${issue.path.join(".")}: ` : ""}${issue?.message ?? "Invalid request"}`);
}

export const pushRoutes = new Hono<AppEnv>();
pushRoutes.use("*", requireAuth, requireFeature("push"));

pushRoutes
  /** The VAPID public key the browser passes as `applicationServerKey`. 503 `push_unconfigured` when the keys are unusable. */
  .get("/key", async (c) => c.json({ publicKey: await c.get("push").publicKey() }))
  .post("/subscriptions", async (c) => {
    const body = pushSubscribeSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw invalid(body.error.issues[0]);
    await c.get("push").subscribe(c.get("user").id, body.data);
    return c.body(null, 204);
  })
  .delete("/subscriptions", async (c) => {
    const body = pushSubscribeSchema.pick({ endpoint: true }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw invalid(body.error.issues[0]);
    await c.get("push").unsubscribe(c.get("user").id, body.data.endpoint);
    return c.body(null, 204);
  });
