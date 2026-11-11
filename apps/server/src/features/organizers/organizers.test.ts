import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { cleanNames, organizerSlug } from "./service.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-org-"));
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
const ctx = await mk();
const { A, B, call, json } = ctx;
const recipe = (name: string, extra: object = {}) => call(A, "POST", "/recipes", { name, ...extra });
const slugs = async (qs: string) => (await json(await call(A, "GET", `/recipes?${qs}`))).items.map((i: any) => i.slug).sort();

describe("helpers", () => {
  it("slugs and cleans names", () => {
    expect(organizerSlug("Crème Brûlée!")).toBe("creme-brulee");
    expect(cleanNames([" Vegan ", "vegan", "", "Quick  Meals"])).toEqual(["Vegan", "Quick Meals"]);
  });
});

describe("recipes and organisers", () => {
  it("upserts by name, case-insensitively, and returns refs", async () => {
    const r1 = await json(await recipe("Soup", { tags: ["Vegan", "Quick"], categories: ["Dinner"], tools: ["Pot"] }));
    expect(r1.tags).toEqual([{ name: "Quick", slug: "quick" }, { name: "Vegan", slug: "vegan" }]);
    expect(r1.tools).toEqual([{ name: "Pot", slug: "pot" }]);
    await recipe("Salad", { tags: ["vegan"], categories: ["Lunch"] });
    const list = await json(await call(A, "GET", "/organizers/tags"));
    expect(list.items).toEqual([
      { name: "Quick", slug: "quick", count: 1 },
      { name: "Vegan", slug: "vegan", count: 2 },
    ]);
  });

  it("filters: OR within a type, AND across types, with q", async () => {
    await recipe("Pie", { tags: ["Sweet"], categories: ["Dinner"] });
    expect(await slugs("tag=vegan")).toEqual(["salad", "soup"]);
    expect(await slugs("tag=vegan&tag=sweet")).toEqual(["pie", "salad", "soup"]);
    expect(await slugs("tag=vegan&category=dinner")).toEqual(["soup"]);
    expect(await slugs("tag=vegan&q=sal")).toEqual(["salad"]);
    expect(await slugs("tool=pot")).toEqual(["soup"]);
    expect(await slugs("tag=nope")).toEqual([]);
    const sum = await json(await call(A, "GET", "/recipes?tag=sweet"));
    expect(sum.items[0].tags).toEqual([{ name: "Sweet", slug: "sweet" }]);
    expect(sum.items[0].categories[0].slug).toBe("dinner");
  });

  it("PUT replaces organisers; omitted leaves them", async () => {
    await call(A, "PUT", "/recipes/pie", { name: "Pie", tags: [] });
    expect((await json(await call(A, "GET", "/recipes/pie"))).tags).toEqual([]);
    await call(A, "PUT", "/recipes/soup", { name: "Soup" });
    expect((await json(await call(A, "GET", "/recipes/soup"))).tags).toHaveLength(2);
  });

  it("CRUD, rename and conflicts", async () => {
    const c = await call(A, "POST", "/organizers/tags", { name: "Spicy" });
    expect(c.status).toBe(201);
    expect((await call(A, "POST", "/organizers/tags", { name: "SPICY" })).status).toBe(409);
    expect((await call(A, "POST", "/organizers/tags", { name: " " })).status).toBe(400);
    const p = await json(await call(A, "PATCH", "/organizers/tags/spicy", { name: "Hot" }));
    expect(p).toMatchObject({ name: "Hot", slug: "hot" });
    expect((await call(A, "PATCH", "/organizers/tags/hot", { name: "vegan" })).status).toBe(409);
    expect((await call(A, "DELETE", "/organizers/tags/hot")).status).toBe(204);
    expect((await call(A, "DELETE", "/organizers/tags/hot")).status).toBe(404);
    expect((await call(A, "GET", "/organizers/widgets")).status).toBe(404);
  });

  it("merges, keeping one link when a recipe has both", async () => {
    await recipe("Both", { tags: ["Veg", "Vegan"] });
    await recipe("OnlyVeg", { tags: ["Veg"] });
    const m = await json(await call(A, "POST", "/organizers/tags/veg/merge", { into: "vegan" }));
    expect(m).toMatchObject({ slug: "vegan", count: 4 });
    expect(await slugs("tag=veg")).toEqual([]);
    expect(await slugs("tag=vegan")).toEqual(["both", "onlyveg", "salad", "soup"]);
    expect((await call(A, "POST", "/organizers/tags/vegan/merge", { into: "vegan" })).status).toBe(400);
    expect((await call(A, "POST", "/organizers/tags/vegan/merge", { into: "zzz" })).status).toBe(404);
  });

  it("deleting an item unlinks it from recipes", async () => {
    await call(A, "DELETE", "/organizers/categories/lunch");
    expect((await json(await call(A, "GET", "/recipes/salad"))).categories).toEqual([]);
  });

  it("isolates households", async () => {
    expect((await json(await call(B, "GET", "/organizers/tags"))).items).toEqual([]);
    expect((await call(B, "PATCH", "/organizers/tags/vegan", { name: "X" })).status).toBe(404);
    expect((await call(B, "DELETE", "/organizers/tags/vegan")).status).toBe(404);
    expect((await call(B, "POST", "/organizers/tags/vegan/merge", { into: "sweet" })).status).toBe(404);
    const r = await json(await call(B, "POST", "/recipes", { name: "Soup", tags: ["Vegan"] }));
    expect(r.tags).toEqual([{ name: "Vegan", slug: "vegan" }]);
    const bl = await json(await call(B, "GET", "/recipes?tag=vegan"));
    expect(bl.items).toHaveLength(1);
    expect((await json(await call(A, "GET", "/organizers/tags"))).items.find((t: any) => t.slug === "vegan").count).toBe(4);
  });

  it("requires auth", async () => {
    expect((await ctx.app.request("/api/v1/organizers/tags")).status).toBe(401);
  });
});

describe("flag off", () => {
  it("404s the routes and ignores organiser fields", async () => {
    const o = await mk({ MEALLY_FEATURE_ORGANIZERS: "off" });
    expect((await o.call(o.A, "GET", "/organizers/tags")).status).toBe(404);
    const r = await o.json(await o.call(o.A, "POST", "/recipes", { name: "Soup", tags: ["Vegan"] }));
    expect(r.tags).toBeUndefined();
    const l = await o.json(await o.call(o.A, "GET", "/recipes?tag=vegan"));
    expect(l.items).toHaveLength(1);
    expect(l.items[0].tags).toBeUndefined();
  });
});
