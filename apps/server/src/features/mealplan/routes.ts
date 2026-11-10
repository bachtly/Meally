import { Hono, type Context } from "hono";
import { dateSchema, mealPlanEntryInput, mealPlanEntryPatch, mealPlanRuleInput, MAX_RANGE_DAYS, suggestInput, z } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { buildIcal } from "./ical.js";
import {
  addDays,
  createEntry,
  createRule,
  daysBetween,
  deleteEntry,
  deleteRule,
  getFeedToken,
  householdForToken,
  listEntries,
  listRules,
  patchEntry,
  rotateFeedToken,
  suggest,
  today,
  updateRule,
} from "./service.js";

function body<S extends z.ZodTypeAny>(raw: unknown, schema: S): z.output<S> {
  const p = schema.safeParse(raw);
  if (!p.success) {
    const i = p.error.issues[0];
    throw new ApiError(400, "invalid_body", `${i?.path.length ? `${i.path.join(".")}: ` : ""}${i?.message ?? "Invalid request"}`);
  }
  return p.data;
}
const json = (c: Context<AppEnv>) => c.req.json().catch(() => null);
const orgOn = async (c: Context<AppEnv>) => (await c.get("flags").getFeatures()).organizers.enabled;
const range = z.object({ from: dateSchema, to: dateSchema });
const FEED = { token: "", path: "/api/v1/meal-plan/ical" };

export const mealPlanRoutes = new Hono<AppEnv>();
mealPlanRoutes.use("*", requireFeature("meal-plan"));

// Calendar apps cannot log in, so the feed is authorised by its per-household token instead of a session.
mealPlanRoutes.get("/ical", async (c) => {
  const token = c.req.query("token") ?? "";
  const householdId = token ? await householdForToken(c.get("db"), token) : null;
  if (!householdId) throw new ApiError(404, "not_found", "Not found");
  const t = today();
  const entries = await listEntries(c.get("db"), householdId, addDays(t, -30), addDays(t, 365));
  return c.body(buildIcal(entries, "Meally meal plan"), 200, {
    "content-type": "text/calendar; charset=utf-8",
    "cache-control": "private, max-age=300",
  });
});

mealPlanRoutes.use("*", requireAuth);

mealPlanRoutes
  .get("/", async (c) => {
    const q = body({ from: c.req.query("from"), to: c.req.query("to") }, range);
    const span = daysBetween(q.from, q.to);
    if (span < 0) throw new ApiError(400, "invalid_range", "'to' must not be before 'from'");
    if (span + 1 > MAX_RANGE_DAYS) throw new ApiError(400, "range_too_large", `Ask for at most ${MAX_RANGE_DAYS} days`);
    return c.json({ items: await listEntries(c.get("db"), c.get("householdId"), q.from, q.to) });
  })
  .get("/today", async (c) => {
    const date = c.req.query("date") ? body(c.req.query("date"), dateSchema) : today();
    return c.json({ date, items: await listEntries(c.get("db"), c.get("householdId"), date, date) });
  })
  .post("/", async (c) => c.json(await createEntry(c.get("db"), c.get("householdId"), c.get("user").id, body(await json(c), mealPlanEntryInput)), 201))
  .post("/suggest", async (c) => {
    const q = body(await json(c), suggestInput);
    return c.json({ recipe: await suggest(c.get("db"), c.get("householdId"), q.date, q.mealType, await orgOn(c)) });
  })
  .get("/rules", async (c) => c.json({ items: await listRules(c.get("db"), c.get("householdId")) }))
  .post("/rules", async (c) => c.json(await createRule(c.get("db"), c.get("householdId"), body(await json(c), mealPlanRuleInput)), 201))
  .put("/rules/:id", async (c) => c.json(await updateRule(c.get("db"), c.get("householdId"), c.req.param("id"), body(await json(c), mealPlanRuleInput))))
  .delete("/rules/:id", async (c) => {
    await deleteRule(c.get("db"), c.get("householdId"), c.req.param("id"));
    return c.body(null, 204);
  })
  .get("/ical/token", async (c) => c.json({ ...FEED, token: await getFeedToken(c.get("db"), c.get("householdId")) }))
  .post("/ical/token", async (c) => c.json({ ...FEED, token: await rotateFeedToken(c.get("db"), c.get("householdId")) }))
  .patch("/:id", async (c) => c.json(await patchEntry(c.get("db"), c.get("householdId"), c.req.param("id"), body(await json(c), mealPlanEntryPatch))))
  .delete("/:id", async (c) => {
    await deleteEntry(c.get("db"), c.get("householdId"), c.req.param("id"));
    return c.body(null, 204);
  });
