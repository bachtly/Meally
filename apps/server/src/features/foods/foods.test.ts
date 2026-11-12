import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseIngredient } from "@meally/shared";
import { createApp } from "../../app.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-foods-"));
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
  return { A, B, call, json };
}
const { A, B, call, json } = await mk();
const ing = (food: string, raw = food) => ({ raw, food, quantity: 1, unit: null });
const recipe = async (name: string, foods: string[]) =>
  json(await call(A, "POST", "/recipes", { name, ingredients: foods.map((f) => ing(f)) }));
const foods = async (q = "") => (await json(await call(A, "GET", `/foods${q}`))).items as any[];
const byName = (list: any[], n: string) => list.find((f) => f.name === n);

describe("foods", () => {
  it("links on save, creating foods and matching case-insensitively", async () => {
    await recipe("Soup", ["Onion", "salt"]);
    await recipe("Stew", ["onion", "ONION"]);
    const list = await foods();
    expect(list.map((f) => f.name).sort()).toEqual(["Onion", "salt"]);
    expect(byName(list, "Onion").count).toBe(2);
  });

  it("matches aliases and plurals instead of creating duplicates", async () => {
    const f = await json(await call(A, "POST", "/foods", { name: "Scallion", pluralName: "Scallions", aliases: ["green onion"] }));
    expect(f.count).toBe(0);
    await recipe("Noodles", ["green onion", "scallions"]);
    expect(byName(await foods(), "Scallion").count).toBe(1);
    expect((await foods()).filter((x) => /scallion|green/i.test(x.name))).toHaveLength(1);
  });

  it("searches", async () => {
    expect((await foods("?q=green")).map((f) => f.name)).toEqual(["Scallion"]);
  });

  it("renames, updating recipes, and rejects duplicate spellings", async () => {
    const r = await recipe("Garlic bread", ["garlic"]);
    const g = byName(await foods(), "garlic");
    expect((await call(A, "PATCH", `/foods/${g.id}`, { name: "Salt" })).status).toBe(409);
    const res = await call(A, "PATCH", `/foods/${g.id}`, { name: "Garlic", aliases: ["stinking rose"] });
    expect(res.status).toBe(200);
    const got = await json(await call(A, "GET", `/recipes/${r.slug}`));
    expect(got.ingredients[0].food).toBe("Garlic");
  });

  it("sets the default aisle and rejects foreign ones", async () => {
    const aisles = (await json(await call(A, "GET", "/shopping/aisles"))).items;
    const g = byName(await foods(), "Garlic");
    const ok = await json(await call(A, "PATCH", `/foods/${g.id}`, { aisleId: aisles[0].id }));
    expect(ok.aisleId).toBe(aisles[0].id);
    const bAisles = (await json(await call(B, "GET", "/shopping/aisles"))).items;
    expect((await call(A, "PATCH", `/foods/${g.id}`, { aisleId: bAisles[0].id })).status).toBe(400);
  });

  it("merges: relinks ingredients, moves aliases, updates the recipe display", async () => {
    const r = await recipe("Fried rice", ["spring onion"]);
    const so = byName(await foods(), "spring onion");
    const sc = byName(await foods(), "Scallion");
    expect((await call(A, "POST", `/foods/${so.id}/merge`, { into: so.id })).status).toBe(400);
    const merged = await json(await call(A, "POST", `/foods/${so.id}/merge`, { into: sc.id }));
    expect(merged.aliases).toContain("spring onion");
    expect(merged.aliases).toContain("green onion");
    expect(merged.count).toBe(2);
    expect(byName(await foods(), "spring onion")).toBeUndefined();
    const got = await json(await call(A, "GET", `/recipes/${r.slug}`));
    expect(got.ingredients[0].food).toBe("Scallion");
    // the old spelling now resolves to the merged food
    await recipe("Again", ["Spring Onion"]);
    expect(byName(await foods(), "Scallion").count).toBe(3);
  });

  it("guards delete when in use, and unlinks with force", async () => {
    const sc = byName(await foods(), "Scallion");
    const res = await call(A, "DELETE", `/foods/${sc.id}`);
    expect(res.status).toBe(409);
    expect((await call(A, "DELETE", `/foods/${sc.id}?force=1`)).status).toBe(204);
    expect(byName(await foods(), "Scallion")).toBeUndefined();
    const free = await json(await call(A, "POST", "/foods", { name: "Unused" }));
    expect((await call(A, "DELETE", `/foods/${free.id}`)).status).toBe(204);
  });

  it("merges identical foods on shopping lists whatever the spelling", async () => {
    const x = await json(await call(A, "POST", "/foods", { name: "Cilantro", aliases: ["coriander"] }));
    const r1 = await recipe("Salsa", ["cilantro"]);
    const r2 = await recipe("Curry", ["coriander"]);
    const list = await json(await call(A, "POST", "/shopping/lists", { name: "L" }));
    await call(A, "POST", `/shopping/lists/${list.id}/add-recipe`, { slug: r1.slug });
    await call(A, "POST", `/shopping/lists/${list.id}/add-recipe`, { slug: r2.slug });
    const { items } = await json(await call(A, "GET", `/shopping/lists/${list.id}`));
    expect(items.filter((i: any) => i.food === "Cilantro")).toHaveLength(1);
    expect(x.name).toBe("Cilantro");
  });
});

describe("units", () => {
  it("lists built-ins read-only next to custom ones, with CRUD", async () => {
    const u = await json(await call(A, "POST", "/units", { name: "scoop", plural: "scoops", kind: "volume", factor: 60 }));
    expect(u.key).toBe("c-scoop");
    const list = (await json(await call(A, "GET", "/units"))).items as any[];
    expect(list.find((x) => x.key === "cup").builtIn).toBe(true);
    expect(list.find((x) => x.key === "c-scoop").builtIn).toBe(false);
    expect((await call(A, "POST", "/units", { name: "cup" })).status).toBe(409);
    expect((await call(A, "PATCH", `/units/${u.id}`, { name: "big scoop" })).status).toBe(200);
    const parsed = await json(await call(A, "POST", "/ingredients/parse", { lines: ["2 scoops protein powder"] }));
    expect(parsed.parsed[0]).toMatchObject({ quantity: 2, unit: "c-scoop", food: "protein powder" });
  });

  it("guards deleting a unit in use", async () => {
    const u = (await json(await call(A, "GET", "/units"))).items.find((x: any) => x.key === "c-scoop");
    const r = await json(await call(A, "POST", "/recipes", { name: "Shake", ingredients: [{ raw: "1 scoop whey", unit: "c-scoop", food: "whey", quantity: 1 }] }));
    expect((await call(A, "DELETE", `/units/${u.id}`)).status).toBe(409);
    expect((await call(A, "DELETE", `/units/${u.id}?force=1`)).status).toBe(204);
    expect((await json(await call(A, "GET", `/recipes/${r.slug}`))).ingredients[0].unit).toBeNull();
  });
});

describe("parser vocab", () => {
  it("is optional and pure", () => {
    expect(parseIngredient("2 scoops whey")).toMatchObject({ unit: null });
    const vocab = { units: [{ key: "c-scoop", names: ["scoop", "scoops"] }], foods: [{ name: "Scallion", aliases: ["green onion"] }] };
    expect(parseIngredient("2 scoops whey", vocab)).toMatchObject({ unit: "c-scoop", food: "whey" });
    expect(parseIngredient("3 green onions", vocab).food).toBe("green onions");
    expect(parseIngredient("3 Green Onion", vocab).food).toBe("Scallion");
  });
});

describe("isolation and flag", () => {
  it("hides another user's foods and units", async () => {
    const f = byName(await foods(), "Garlic");
    expect((await json(await call(B, "GET", "/foods"))).items).toEqual([]);
    expect((await call(B, "PATCH", `/foods/${f.id}`, { name: "x" })).status).toBe(404);
    expect((await call(B, "DELETE", `/foods/${f.id}`)).status).toBe(404);
    expect((await call(B, "POST", `/foods/${f.id}/merge`, { into: f.id })).status).toBe(400);
    const other = await json(await call(B, "POST", "/foods", { name: "Mine" }));
    expect((await call(A, "POST", `/foods/${f.id}/merge`, { into: other.id })).status).toBe(404);
    const u = (await json(await call(A, "GET", "/units"))).items.find((x: any) => !x.builtIn);
    expect(u).toBeUndefined();
  });

  it("is off with the flag, and recipes then link nothing", async () => {
    const off = await mk({ MEALLY_FEATURE_FOODS_UNITS: "off" });
    expect((await off.call(off.A, "GET", "/foods")).status).toBe(404);
    expect((await off.call(off.A, "GET", "/units")).status).toBe(404);
    const r = await off.call(off.A, "POST", "/recipes", { name: "X", ingredients: [ing("egg")] });
    expect(r.status).toBe(201);
  });
});
