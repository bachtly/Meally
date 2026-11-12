import { Hono, type Context } from "hono";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { viewerOf } from "../../lib/access.js";
import { requireAuth } from "../auth/middleware.js";
import { clientIp } from "../auth/routes.js";
import { requireFeature } from "../features/middleware.js";
import * as svc from "./service.js";

function limit(c: Context<AppEnv>, key: string) {
  const r = c.get("auth").inviteLimiter.hit(key);
  if (!r.ok) {
    c.header("Retry-After", String(r.retryAfterSec));
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
  }
}

export const friendRoutes = new Hono<AppEnv>();
friendRoutes.use("*", requireAuth, requireFeature("friends"));

friendRoutes
  .get("/", async (c) => c.json(await svc.listFriends(c.get("db"), viewerOf(c).userId)))
  .post("/invites", async (c) => {
    const inv = await svc.createInvite(c.get("db"), viewerOf(c).userId);
    const path = `/invite/${inv.token}`;
    return c.json({ id: inv.id, url: `${c.get("auth").baseOrigin}${path}`, path, token: inv.token, expiresAt: inv.expiresAt }, 201);
  })
  .get("/invites", async (c) => c.json({ items: await svc.listInvites(c.get("db"), viewerOf(c).userId) }))
  .delete("/invites/:id", async (c) => {
    await svc.revokeInvite(c.get("db"), viewerOf(c).userId, c.req.param("id"));
    return c.body(null, 204);
  })
  .get("/invites/:token", async (c) => {
    limit(c, `friend-view:${clientIp(c)}`);
    return c.json(await svc.previewInvite(c.get("db"), c.req.param("token")));
  })
  .post("/invites/:token/accept", async (c) => {
    limit(c, `friend-accept:${viewerOf(c).userId}`);
    const { friend, created } = await svc.acceptInvite(c.get("db"), viewerOf(c).userId, c.req.param("token"));
    return c.json(friend, created ? 201 : 200);
  })
  .delete("/:userId", async (c) => {
    await svc.removeFriend(c.get("db"), viewerOf(c).userId, c.req.param("userId"));
    return c.body(null, 204);
  });
