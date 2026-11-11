import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { buildIcal, escapeText, foldLine } from "./ical.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-mp-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const app = createApp({ env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, dataDir });
  const su = async (p: string, email: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password: "correct horse" }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = await su("register", "b@example.com");
  const call = (cookie: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (r: Response) => (await r.json()) as any;
  return { app, A, B, call, json };
}

describe("ical helpers", () => {
  it("escapes and folds", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const folded = foldLine("X:" + "é".repeat(100));
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe("X:" + "é".repeat(100));
  });
  it("builds an all-day event", () => {
    const out = buildIcal([{ id: "1", date: "2026-12-31", mealType: "dinner", title: "Leftovers, yum", note: null, position: 0, recipe: null }], "Plan");
    expect(out).toContain("DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101\r\n");
    expect(out).toContain("SUMMARY:Dinner: Leftovers\\, yum\r\n");
    expect(out.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("meal plan API", () => {
  it("CRUD, range limit, move, reorder", async () => {
    const { A, call, json } = await mk();
    const r = await json(await call(A, "POST", "/recipes", { name: "Soup" }));
    const e1 = await json(await call(A, "POST", "/meal-plan", { date: "2026-03-02", mealType: "dinner", recipeId: r.id }));
    expect(e1.recipe.slug).toBe("soup");
    const e2 = await json(await call(A, "POST", "/meal-plan", { date: "2026-03-02", mealType: "dinner", title: "Leftovers" }));
    expect(e2.position).toBe(1);
    expect((await call(A, "POST", "/meal-plan", { date: "2026-03-02", mealType: "dinner" })).status).toBe(400);
    expect((await call(A, "POST", "/meal-plan", { date: "2026-02-30", mealType: "dinner", title: "x" })).status).toBe(400);

    const list = await json(await call(A, "GET", "/meal-plan?from=2026-03-01&to=2026-03-07"));
    expect(list.items.map((i: any) => i.id)).toEqual([e1.id, e2.id]);

    await call(A, "PATCH", `/meal-plan/${e2.id}`, { position: 0 });
    const re = await json(await call(A, "GET", "/meal-plan?from=2026-03-02&to=2026-03-02"));
    expect(re.items.map((i: any) => i.id)).toEqual([e2.id, e1.id]);

    const moved = await json(await call(A, "PATCH", `/meal-plan/${e1.id}`, { date: "2026-03-03", mealType: "lunch", note: "hi" }));
    expect([moved.date, moved.mealType, moved.note]).toEqual(["2026-03-03", "lunch", "hi"]);

    expect((await call(A, "GET", "/meal-plan?from=2026-01-01&to=2026-03-04")).status).toBe(400); // 63 days
    expect((await call(A, "GET", "/meal-plan?from=2026-01-01&to=2026-03-03")).status).toBe(200); // 62 days
    expect((await call(A, "GET", "/meal-plan?from=2026-03-05&to=2026-03-01")).status).toBe(400);

    const t = await json(await call(A, "GET", "/meal-plan/today?date=2026-03-03"));
    expect(t.items).toHaveLength(1);

    expect((await call(A, "DELETE", `/meal-plan/${e2.id}`)).status).toBe(204);
    expect((await call(A, "DELETE", `/meal-plan/${e2.id}`)).status).toBe(404);
    // recipe delete keeps the entry
    await call(A, "DELETE", "/recipes/soup");
    const after = await json(await call(A, "GET", "/meal-plan?from=2026-03-03&to=2026-03-03"));
    expect(after.items[0].recipe).toBeNull();
  });

  it("suggest honours rules and avoids recent recipes", async () => {
    const { A, call, json } = await mk();
    const mkr = async (name: string, tags: string[]) => json(await call(A, "POST", "/recipes", { name, tags }));
    const pz1 = await mkr("Pizza 1", ["pizza"]);
    const pz2 = await mkr("Pizza 2", ["pizza"]);
    await mkr("Salad", ["green"]);
    // 2026-03-06 is a Friday
    const none = await json(await call(A, "POST", "/meal-plan/suggest", { date: "2026-03-06", mealType: "dinner" }));
    expect(none.recipe).not.toBeNull();
    await call(A, "POST", "/meal-plan/rules", { mealType: "dinner", dayOfWeek: 5, tags: ["pizza"] });
    await call(A, "POST", "/meal-plan", { date: "2026-03-04", mealType: "dinner", recipeId: pz1.id });
    for (let i = 0; i < 10; i++) {
      const s = await json(await call(A, "POST", "/meal-plan/suggest", { date: "2026-03-06", mealType: "dinner" }));
      expect(s.recipe.id).toBe(pz2.id);
    }
    // Saturday: rule does not apply, so Salad may appear; lunch on Friday likewise
    const names = new Set<string>();
    for (let i = 0; i < 40; i++) names.add((await json(await call(A, "POST", "/meal-plan/suggest", { date: "2026-03-06", mealType: "lunch" }))).recipe.name);
    expect(names.has("Salad")).toBe(true);
    // all pizzas recent: falls back to them
    await call(A, "POST", "/meal-plan", { date: "2026-03-05", mealType: "dinner", recipeId: pz2.id });
    const fb = await json(await call(A, "POST", "/meal-plan/suggest", { date: "2026-03-06", mealType: "dinner" }));
    expect([pz1.id, pz2.id]).toContain(fb.recipe.id);
    // rules CRUD
    const rules = await json(await call(A, "GET", "/meal-plan/rules"));
    expect(rules.items).toHaveLength(1);
    const up = await json(await call(A, "PUT", `/meal-plan/rules/${rules.items[0].id}`, { mealType: "any", tags: ["green"], dayOfWeek: null }));
    expect(up.tags).toEqual(["green"]);
    expect((await call(A, "DELETE", `/meal-plan/rules/${up.id}`)).status).toBe(204);
    expect((await call(A, "DELETE", `/meal-plan/rules/${up.id}`)).status).toBe(404);
  });

  it("serves an iCal feed by token and rotates it", async () => {
    const { app, A, call, json } = await mk();
    const d = new Date().toISOString().slice(0, 10);
    await call(A, "POST", "/meal-plan", { date: d, mealType: "lunch", title: "Soup; hot", note: "line1\nline2" });
    const { token } = await json(await call(A, "GET", "/meal-plan/ical/token"));
    const res = await app.request(`/api/v1/meal-plan/ical?token=${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const text = await res.text();
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(text).toContain("SUMMARY:Lunch: Soup\\; hot");
    expect(text).toContain("DESCRIPTION:line1\\nline2");
    expect((await app.request("/api/v1/meal-plan/ical")).status).toBe(404);
    expect((await app.request("/api/v1/meal-plan/ical?token=nope")).status).toBe(404);
    const next = (await json(await call(A, "POST", "/meal-plan/ical/token"))).token;
    expect(next).not.toBe(token);
    expect((await app.request(`/api/v1/meal-plan/ical?token=${token}`)).status).toBe(404);
    expect((await app.request(`/api/v1/meal-plan/ical?token=${next}`)).status).toBe(200);
  });

  it("isolates households", async () => {
    const { app, A, B, call, json } = await mk();
    const e = await json(await call(A, "POST", "/meal-plan", { date: new Date().toISOString().slice(0, 10), mealType: "dinner", title: "Mine" }));
    const r = await json(await call(A, "POST", "/recipes", { name: "Secret" }));
    const rule = await json(await call(A, "POST", "/meal-plan/rules", { mealType: "any", tags: [] }));
    expect((await call(B, "PATCH", `/meal-plan/${e.id}`, { note: "x" })).status).toBe(404);
    expect((await call(B, "DELETE", `/meal-plan/${e.id}`)).status).toBe(404);
    expect((await call(B, "DELETE", `/meal-plan/rules/${rule.id}`)).status).toBe(404);
    expect((await call(B, "POST", "/meal-plan", { date: "2026-03-02", mealType: "dinner", recipeId: r.id })).status).toBe(400);
    expect((await json(await call(B, "GET", `/meal-plan?from=${e.date}&to=${e.date}`))).items).toEqual([]);
    expect((await json(await call(B, "POST", "/meal-plan/suggest", { date: "2026-03-02", mealType: "dinner" }))).recipe).toBeNull();
    const tokenA = (await json(await call(A, "GET", "/meal-plan/ical/token"))).token;
    const tokenB = (await json(await call(B, "GET", "/meal-plan/ical/token"))).token;
    expect(await (await app.request(`/api/v1/meal-plan/ical?token=${tokenB}`)).text()).not.toContain("Mine");
    expect(await (await app.request(`/api/v1/meal-plan/ical?token=${tokenA}`)).text()).toContain("Mine");
  });

  it("requires auth", async () => {
    const { app } = await mk();
    expect((await app.request("/api/v1/meal-plan?from=2026-03-01&to=2026-03-02")).status).toBe(401);
  });

  it("is hidden when the flag is off", async () => {
    const { app, A, call } = await mk({ MEALLY_FEATURE_MEAL_PLAN: "off" });
    expect((await call(A, "GET", "/meal-plan?from=2026-03-01&to=2026-03-02")).status).toBe(404);
    expect((await app.request("/api/v1/meal-plan/ical?token=x")).status).toBe(404);
  });
});
