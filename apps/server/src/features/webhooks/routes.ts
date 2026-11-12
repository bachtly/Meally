import { Hono, type Context } from "hono";
import { webhookInputSchema } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { allowPrivateUrls } from "../import-url/fetch.js";
import * as svc from "./service.js";

export const webhookRoutes = new Hono<AppEnv>();
webhookRoutes.use("*", requireAuth, requireFeature("webhooks"));

async function input(c: Context<AppEnv>) {
  const p = webhookInputSchema.safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "invalid_body", p.error.issues[0]?.message ?? "Invalid webhook");
  return p.data;
}

webhookRoutes
  .get("/", async (c) => c.json({ items: await svc.listWebhooks(c.get("db"), c.get("userId")) }))
  .post("/", async (c) => c.json(await svc.createWebhook(c.get("db"), c.get("userId"), await input(c), allowPrivateUrls(c.get("env"))), 201))
  .get("/:id", async (c) => c.json(await svc.getWebhook(c.get("db"), c.get("userId"), c.req.param("id"))))
  .put("/:id", async (c) => c.json(await svc.updateWebhook(c.get("db"), c.get("userId"), c.req.param("id"), await input(c), allowPrivateUrls(c.get("env")))))
  .delete("/:id", async (c) => {
    await svc.deleteWebhook(c.get("db"), c.get("userId"), c.req.param("id"));
    return c.body(null, 204);
  })
  .post("/:id/test", async (c) => c.json(await c.get("webhooks").sendTest(c.get("userId"), c.req.param("id"))))
  .get("/:id/deliveries", async (c) => c.json({ items: await svc.listDeliveries(c.get("db"), c.get("userId"), c.req.param("id")) }));
