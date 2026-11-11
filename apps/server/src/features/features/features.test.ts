import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createTestDb } from "../../db/testing.js";
import type { AppEnv } from "../../lib/context.js";
import { requireFeature } from "./middleware.js";
import { createFlagsService } from "./service.js";

async function setup(env: Record<string, string> = {}) {
  const { db } = await createTestDb();
  const flags = createFlagsService(db, env);
  return { flags, app: createApp({ db, flags }) };
}
const get = async (app: ReturnType<typeof createApp>) =>
  (await (await app.request("/api/v1/features")).json()) as { features: Record<string, any> };

describe("GET /api/v1/features", () => {
  it("returns resolved map with labels", async () => {
    const { features } = await get((await setup()).app);
    expect(features["meal-plan"]).toMatchObject({ enabled: true, locked: false, source: "default", label: "Meal planner" });
    expect(features.ai.enabled).toBe(false);
  });
  it("env lock wins over override", async () => {
    const { app, flags } = await setup({ MEALLY_FEATURE_MEAL_PLAN: "off" });
    await flags.setOverride("meal-plan", true);
    expect((await get(app)).features["meal-plan"]).toMatchObject({ enabled: false, locked: true, source: "env" });
  });
  it("override applies, is cache-invalidated, and can be cleared", async () => {
    const { app, flags } = await setup();
    expect((await get(app)).features.ai.enabled).toBe(false);
    await flags.setOverride("ai", true);
    expect((await get(app)).features.ai).toMatchObject({ enabled: true, source: "override" });
    await flags.setOverride("ai", null);
    expect((await get(app)).features.ai).toMatchObject({ enabled: false, source: "default" });
  });
  it("dependency off disables dependants", async () => {
    const { app, flags } = await setup();
    await flags.setOverride("organizers", false);
    expect((await get(app)).features.cookbooks).toMatchObject({ enabled: false, source: "dependency" });
  });
});

describe("requireFeature", () => {
  it("returns 404 feature_disabled, and passes when on", async () => {
    const { flags } = await setup();
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("flags", flags);
      await next();
    });
    app.get("/plan", requireFeature("meal-plan"), (c) => c.json({ ok: true }));
    expect((await app.request("/plan")).status).toBe(200);
    await flags.setOverride("meal-plan", false);
    const res = await app.request("/plan");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "feature_disabled" });
  });
});
