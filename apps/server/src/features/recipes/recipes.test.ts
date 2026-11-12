import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { slugify } from "./service.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-recipes-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const app = createApp({ env: { MEALLY_SIGNUP_MODE: "open" }, scryptLogN: 10, dataDir });
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function signup(path: string, email: string) {
  const res = await app.request(`/api/v1/auth/${path}`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ email, name: email.split("@")[0], password: "correct horse" }),
  });
  expect(res.status).toBe(201);
  return res.headers.get("set-cookie")!.split(";")[0]!;
}
const A = await signup("setup", "a@example.com");
const B = await signup("register", "b@example.com");

const call = (cookie: string, method: string, url: string, body?: unknown) =>
  app.request(`/api/v1${url}`, {
    method,
    headers: { ...H, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ing = (raw: string, food?: string) => ({ raw, food: food ?? null });
const make = (cookie: string, name: string, extra: object = {}) => call(cookie, "POST", "/recipes", { name, ...extra });

describe("recipes CRUD", () => {
  it("requires auth", async () => {
    expect((await app.request("/api/v1/recipes")).status).toBe(401);
  });

  it("creates, reads, replaces and deletes", async () => {
    const res = await make(A, "Lemon Tart", {
      servings: 6,
      sourceUrl: "https://example.com/tart",
      ingredients: [{ raw: "2 cups flour", quantity: 2, unit: "cups", food: "flour", section: "Crust" }, ing("3 lemons")],
      steps: [{ text: "Mix." }, { text: "Bake.", section: "Finish" }],
    });
    expect(res.status).toBe(201);
    const r = (await res.json()) as any;
    expect(r.slug).toBe("lemon-tart");
    expect(r.ingredients.map((i: any) => i.position)).toEqual([0, 1]);
    expect(r.ingredients[0]).toMatchObject({ quantity: 2, unit: "cups", section: "Crust", raw: "2 cups flour" });
    expect(r.steps[1]).toMatchObject({ position: 1, section: "Finish" });

    expect(((await (await call(A, "GET", "/recipes/lemon-tart")).json()) as any).id).toBe(r.id);

    const put = await call(A, "PUT", "/recipes/lemon-tart", { name: "Lemon Tart v2", ingredients: [ing("1 egg")], steps: [] });
    const updated = (await put.json()) as any;
    expect(updated.slug).toBe("lemon-tart"); // slug is stable
    expect(updated.name).toBe("Lemon Tart v2");
    expect(updated.ingredients).toHaveLength(1);
    expect(updated.steps).toHaveLength(0);
    expect(updated.servings).toBeNull();

    expect((await call(A, "DELETE", "/recipes/lemon-tart")).status).toBe(204);
    expect((await call(A, "GET", "/recipes/lemon-tart")).status).toBe(404);
    expect((await call(A, "DELETE", "/recipes/lemon-tart")).status).toBe(404);
    expect(((await (await call(A, "GET", "/recipes?q=egg")).json()) as any).items).toHaveLength(0);
  });

  it("validates input", async () => {
    expect((await make(A, "")).status).toBe(400);
    expect((await make(A, "x", { servings: -1 })).status).toBe(400);
    expect((await make(A, "x", { sourceUrl: "javascript:alert(1)" })).status).toBe(400);
    expect((await make(A, "x", { ingredients: [{ raw: "" }] })).status).toBe(400);
    const bad = await make(A, "x", { steps: [{ text: "" }] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).message).toMatch(/steps\.0\.text/);
    expect((await call(A, "GET", "/recipes?sort=bogus")).status).toBe(400);
    expect((await call(A, "GET", "/recipes?cursor=zzz")).status).toBe(400);
    expect((await call(A, "PUT", "/recipes/nope", { name: "x" })).status).toBe(404);
  });

  it("makes slugs unique per user", async () => {
    const slugs = [];
    for (let i = 0; i < 3; i++) slugs.push(((await (await make(A, "Soup!")).json()) as any).slug);
    expect(slugs).toEqual(["soup", "soup-2", "soup-3"]);
    expect(((await (await make(B, "Soup")).json()) as any).slug).toBe("soup");
    expect(slugify("  Crème brûlée -- 100%  ")).toBe("creme-brulee-100");
    expect(slugify("!!!")).toBe("recipe");
  });
});

describe("search and pagination", () => {
  it("finds recipes by name, description and ingredient with prefix matching", async () => {
    await make(A, "Pad Thai", { description: "Noodles", ingredients: [ing("200g rice noodles"), ing("1 tbsp tamarind paste")] });
    await make(A, "Green Salad", { ingredients: [ing("lettuce")] });
    const q = async (s: string) => ((await (await call(A, "GET", `/recipes?q=${encodeURIComponent(s)}`)).json()) as any).items.map((i: any) => i.slug);
    expect(await q("tamar")).toEqual(["pad-thai"]);
    expect(await q("noodle")).toEqual(["pad-thai"]);
    expect(await q("sal")).toEqual(["green-salad"]);
    expect(await q("rice tamarind")).toEqual(["pad-thai"]);
    expect(await q("nothing-here")).toEqual([]);
    expect(await q("rice -lettuce")).toEqual(["pad-thai"]); // websearch syntax: exclusion
    expect(await q('"rice noodles" tam')).toEqual(["pad-thai"]); // phrase, then prefix on the last word
    expect(await q('"*()')).toEqual([]);
    await call(A, "PUT", "/recipes/pad-thai", { name: "Pad Thai", ingredients: [ing("tofu")] });
    expect(await q("tamarind")).toEqual([]);
    expect(await q("tofu")).toEqual(["pad-thai"]);
  });

  it("pages through every item exactly once for each sort", async () => {
    const C = await signup("register", "c@example.com");
    for (const n of ["Echo", "alpha", "Delta", "Charlie", "Bravo"]) await make(C, n);
    for (const sort of ["updated", "name", "created"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: any = await (await call(C, "GET", `/recipes?sort=${sort}&limit=2${cursor ? `&cursor=${cursor}` : ""}`)).json();
        seen.push(...res.items.map((i: any) => i.name));
        cursor = res.nextCursor;
      } while (cursor);
      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
      if (sort === "name") expect(seen).toEqual(["alpha", "Bravo", "Charlie", "Delta", "Echo"]);
    }
  });
});

describe("images", () => {
  it("resizes to webp at three sizes and serves them with long cache headers", async () => {
    const slug = ((await (await make(A, "Pic Recipe")).json()) as any).slug;
    const png = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#c33" } }).png().toBuffer();
    const upload = (cookie: string, s: string, data: Buffer, type = "image/png") => {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(data)], "x.png", { type }));
      return app.request(`/api/v1/recipes/${s}/image`, { method: "POST", headers: { cookie, "x-requested-with": "meally" }, body: form });
    };
    const res = await upload(A, slug, png);
    expect(res.status).toBe(201);
    const r = (await res.json()) as any;
    expect(r.imageUrl).toMatch(/^\/api\/v1\/images\/[^/]+\/800$/);
    const id = r.imageUrl.split("/")[4];
    for (const [size, width] of [[320, 320], [800, 800], [1600, 1600]] as const) {
      const img = await app.request(`/api/v1/images/${id}/${size}`, { headers: { cookie: A } });
      expect(img.status).toBe(200);
      expect(img.headers.get("content-type")).toBe("image/webp");
      expect(img.headers.get("cache-control")).toContain("max-age=31536000");
      const meta = await sharp(Buffer.from(await img.arrayBuffer())).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.width).toBe(Math.min(width, 2000));
    }
    expect((await app.request(`/api/v1/images/${id}/123`, { headers: { cookie: A } })).status).toBe(404);
    expect(((await (await call(A, "GET", "/recipes?q=pic")).json()) as any).items[0].imageUrl).toMatch(/\/320$/);

    // tenant isolation
    expect((await app.request(`/api/v1/images/${id}/320`, { headers: { cookie: B } })).status).toBe(404);
    expect((await app.request(`/api/v1/images/${id}/320`)).status).toBe(401);
    expect((await upload(B, slug, png)).status).toBe(404);

    // rejects non-images and oversize files
    expect((await upload(A, slug, Buffer.from("hello"), "text/plain")).status).toBe(415);
    expect((await upload(A, slug, Buffer.from("not really a png"), "image/png")).status).toBe(415);
    expect((await upload(A, slug, Buffer.alloc(10 * 1024 * 1024 + 1), "image/png")).status).toBe(413);

    // replacing removes the old files; deleting removes everything
    const second = (await (await upload(A, slug, png)).json()) as any;
    expect((await app.request(`/api/v1/images/${id}/320`, { headers: { cookie: A } })).status).toBe(404);
    await call(A, "DELETE", `/recipes/${slug}`);
    const id2 = second.imageUrl.split("/")[4];
    expect((await app.request(`/api/v1/images/${id2}/320`, { headers: { cookie: A } })).status).toBe(404);
  });
});

describe("tenant isolation", () => {
  it("hides user A's recipes from user B", async () => {
    const a = (await (await make(A, "Secret Stew", { ingredients: [ing("1 kg unobtainium")] })).json()) as any;
    expect((await call(B, "GET", `/recipes/${a.slug}`)).status).toBe(404);
    expect((await call(B, "PUT", `/recipes/${a.slug}`, { name: "Hijack" })).status).toBe(404);
    expect((await call(B, "DELETE", `/recipes/${a.slug}`)).status).toBe(404);
    const list = (await (await call(B, "GET", "/recipes")).json()) as any;
    expect(list.items.some((i: any) => i.id === a.id)).toBe(false);
    for (const q of ["secret", "unobtainium"]) {
      expect(((await (await call(B, "GET", `/recipes?q=${q}`)).json()) as any).items).toEqual([]);
    }
    expect(((await (await call(A, "GET", "/recipes?q=unobtainium")).json()) as any).items).toHaveLength(1);
    expect(((await (await call(A, "GET", `/recipes/${a.slug}`)).json()) as any).name).toBe("Secret Stew");
  });
});
