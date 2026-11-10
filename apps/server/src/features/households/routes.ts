import { Hono, type Context, type MiddlewareHandler } from "hono";
import { householdPatchSchema, inviteInputSchema, joinSchema, memberPatchSchema, z } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import * as svc from "./service.js";

async function body<S extends z.ZodTypeAny>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  const p = schema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "invalid_body", p.error.issues[0]?.message ?? "Invalid request");
  return p.data;
}

const requireOwner: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").householdRole !== "owner") {
    throw new ApiError(403, "forbidden", "Only household owners can do this");
  }
  await next();
};

const detail = (c: Context<AppEnv>) => svc.getHousehold(c.get("db"), c.get("householdId"), c.get("user").id);

export const householdRoutes = new Hono<AppEnv>();
householdRoutes.use("*", requireAuth, requireFeature("households"));

householdRoutes
  .get("/", async (c) => c.json(await detail(c)))
  .patch("/", requireOwner, async (c) => {
    const { name } = await body(c, householdPatchSchema);
    await svc.renameHousehold(c.get("db"), c.get("householdId"), name);
    return c.json(await detail(c));
  })
  .post("/invites", requireOwner, async (c) => {
    const input = await body(c, inviteInputSchema);
    const inv = await svc.createInvite(c.get("db"), c.get("householdId"), c.get("user").id, input);
    const path = `/sign-up?invite=${inv.token}`;
    return c.json(
      { id: inv.id, url: `${c.get("auth").baseOrigin}${path}`, path, token: inv.token, expiresAt: inv.expiresAt },
      201,
    );
  })
  .get("/invites", async (c) => c.json({ items: await svc.listInvites(c.get("db"), c.get("householdId")) }))
  .delete("/invites/:id", requireOwner, async (c) => {
    await svc.revokeInvite(c.get("db"), c.get("householdId"), c.req.param("id"));
    return c.body(null, 204);
  })
  .patch("/members/:userId", requireOwner, async (c) => {
    const { role } = await body(c, memberPatchSchema);
    await svc.setMemberRole(c.get("db"), c.get("householdId"), c.req.param("userId"), role);
    return c.json(await detail(c));
  })
  .delete("/members/:userId", requireOwner, async (c) => {
    await svc.removeMember(c.get("db"), c.get("householdId"), c.get("user").id, c.req.param("userId"));
    return c.body(null, 204);
  })
  .post("/leave", async (c) => {
    await svc.leaveHousehold(c.get("db"), c.get("user").id);
    return c.body(null, 204);
  })
  .post("/join", async (c) => {
    const r = c.get("auth").inviteLimiter.hit(`join:${c.get("user").id}`);
    if (!r.ok) throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
    const { token } = await body(c, joinSchema);
    await svc.joinWithInvite(c.get("db"), c.get("user").id, token);
    return c.body(null, 204);
  });
