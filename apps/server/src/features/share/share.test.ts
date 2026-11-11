import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { hashToken } from "./service.js";
import { openTestDb } from "../../db/testing.js";
import { shareLinks } from "../../db/schema/index.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-share-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const o = openTestDb();
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, dataDir });
  await o.ready;
  const su = async (p: string, email: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password: "correct horse" }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = await su("register", "b@example.com");
  const call = (cookie: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const pub = (url: string) => app.request(`/api/v1/public${url}`);
  const json = async (r: Response) => (await r.json()) as any;
  const recipe = async (name: string, cookie = A) => (await json(await call(cookie, "POST", "/recipes", { name, ingredients: [{ raw: "1 cup milk" }], steps: [{ text: "Stir" }] }))).slug as string;
  const share = async (slug: string, body: unknown = {}) => {
    const url = (await json(await call(A, "POST", `/recipes/${slug}/shares`, body))).url as string;
    return url.split("/s/")[1]!;
  };
  return { app, o, A, B, call, pub, json, recipe, share };
}

describe("share links", () => {
  it("stores only the hash, lists without tokens, and serves a public payload with no internal ids", async () => {
    const { o, call, pub, json, recipe, share, A } = await mk();
    const slug = await recipe("Soup");
    const token = await share(slug, { expiresInDays: 7 });
    expect(token.length).toBeGreaterThanOrEqual(43);
    const rows = await o.db.select().from(shareLinks);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
    const list = await json(await call(A, "GET", `/recipes/${slug}/shares`));
    expect(Object.keys(list.items[0]).sort()).toEqual(["createdAt", "expiresAt", "id", "viewCount"]);
    const res = await pub(`/recipes/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    const body = (await res.json()) as any;
    expect(Object.keys(body).sort()).toEqual(
      ["description", "imageUrl", "ingredients", "name", "notes", "prepMinutes", "cookMinutes", "scaling", "servings", "sourceUrl", "steps", "totalMinutes", "yieldText"].sort(),
    );
    expect(Object.keys(body.ingredients[0]).sort()).toEqual(["food", "note", "position", "quantity", "raw", "section", "unit"]);
    expect(Object.keys(body.steps[0]).sort()).toEqual(["position", "section", "text"]);
    expect((await json(await call(A, "GET", `/recipes/${slug}/shares`))).items[0].viewCount).toBe(1);
  });

  it("revokes, expires, isolates households, and requires auth", async () => {
    const { o, A, B, call, pub, recipe, share, json } = await mk();
    const slug = await recipe("Soup");
    const token = await share(slug);
    const [{ id }] = (await json(await call(A, "GET", `/recipes/${slug}/shares`))).items;
    expect((await call(B, "DELETE", `/shares/${id}`)).status).toBe(404);
    expect((await call(B, "GET", `/recipes/${slug}/shares`)).status).toBe(404);
    expect((await call(B, "POST", `/recipes/${slug}/shares`, {})).status).toBe(404);
    expect((await call(A, "POST", `/recipes/${slug}/shares`, { expiresInDays: 3 })).status).toBe(400);
    expect((await call("", "GET", `/recipes/${slug}/shares`)).status).toBe(401);
    expect((await pub(`/recipes/${token}`)).status).toBe(200);
    expect((await call(A, "DELETE", `/shares/${id}`)).status).toBe(204);
    expect((await pub(`/recipes/${token}`)).status).toBe(404);
    expect((await json(await call(A, "GET", `/recipes/${slug}/shares`))).items).toEqual([]);
    const t2 = await share(slug, { expiresInDays: 1 });
    await o.db.update(shareLinks).set({ expiresAt: new Date(1000) }).where(isNull(shareLinks.revokedAt));
    expect((await pub(`/recipes/${t2}`)).status).toBe(404);
    expect((await pub(`/recipes/nonsense`)).status).toBe(404);
  });

  it("serves only that recipe's image", async () => {
    const { A, app, call, pub, recipe, share } = await mk();
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#c33" } }).png().toBuffer();
    const withImg = await recipe("Pic");
    const form = new FormData();
    form.set("file", new File([new Uint8Array(png)], "x.png", { type: "image/png" }));
    await app.request(`/api/v1/recipes/${withImg}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: A }, body: form });
    const noImg = await recipe("Plain");
    const t1 = await share(withImg);
    const t2 = await share(noImg);
    const ok = await pub(`/recipes/${t1}/image/800`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect((await pub(`/recipes/${t2}/image/800`)).status).toBe(404);
    expect((await pub(`/recipes/${t1}/image/999`)).status).toBe(404);
    const detail = (await (await pub(`/recipes/${t1}`)).json()) as any;
    expect(detail.imageUrl).toBe(`/api/v1/public/recipes/${t1}/image/800`);
    expect((await call(A, "GET", "/recipes/pic")).status).toBe(200);
  });

  it("is rate limited per IP", async () => {
    const { pub } = await mk();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await pub("/recipes/x")).status;
    expect(last).toBe(429);
  });

  it("returns 404 when the flag is off", async () => {
    const { A, call, pub, recipe, share } = await mk();
    const slug = await recipe("Soup");
    const token = await share(slug);
    expect((await pub(`/recipes/${token}`)).status).toBe(200);
    // A second mk() reuses the shared test database (emptied), so the flag-on check had to come first.
    const off = await mk({ MEALLY_FEATURE_SHARE_LINKS: "off" });
    expect((await off.pub(`/recipes/${token}`)).status).toBe(404);
    const s2 = await off.recipe("Soup");
    expect((await off.call(off.A, "POST", `/recipes/${s2}/shares`, {})).status).toBe(404);
    void A; void call;
  });
});

describe("share sets and cookbooks", () => {
  const token = (url: string) => url.split("/s/")[1]!;

  it("shares a hand-picked set in order, with the sharer's name and note, and serves each recipe inside it", async () => {
    const { o, A, call, pub, json, recipe } = await mk();
    const a = await recipe("Apple pie");
    const b = await recipe("Bread");
    const outside = await recipe("Curry");
    const res = await call(A, "POST", "/shares", { recipeSlugs: [b, a], title: "Weekend baking", note: "Try the bread first", expiresInDays: 7 });
    expect(res.status).toBe(201);
    const t = token((await json(res)).url);
    const s = await json(await pub(`/shares/${t}`));
    expect(s).toMatchObject({ kind: "set", title: "Weekend baking", note: "Try the bread first", sharedBy: "n", count: 2, recipe: null });
    expect(s.items.map((i: any) => i.slug)).toEqual([b, a]);
    expect(Object.keys(s.items[0]).sort()).toEqual(["imageUrl", "name", "servings", "slug", "totalMinutes"]);
    expect(JSON.stringify(s)).not.toMatch(/householdId|"id"|example\.com/);
    const one = await pub(`/shares/${t}/recipes/${a}`);
    expect(one.status).toBe(200);
    expect(((await one.json()) as any).name).toBe("Apple pie");
    // A recipe of the household that is not in the set is not reachable through the link.
    expect((await pub(`/shares/${t}/recipes/${outside}`)).status).toBe(404);
    // Sets are live until saved: a deleted recipe drops out.
    await call(A, "DELETE", `/recipes/${b}`);
    expect((await json(await pub(`/shares/${t}`))).count).toBe(1);
    const [link] = await o.db.select().from(shareLinks);
    expect(link!.viewCount).toBe(2);
  });

  it("hides the name when asked, and rejects bad or foreign sets", async () => {
    const { A, B, call, pub, json, recipe } = await mk();
    const a = await recipe("Soup");
    const b = await recipe("Stew", B);
    const t = token((await json(await call(A, "POST", "/shares", { recipeSlugs: [a], showName: false }))).url);
    expect((await json(await pub(`/shares/${t}`))).sharedBy).toBeNull();
    expect((await call(A, "POST", "/shares", { recipeSlugs: [] })).status).toBe(400);
    expect((await call(A, "POST", "/shares", { recipeSlugs: [a, a] })).status).toBe(400);
    expect((await call(A, "POST", "/shares", { recipeSlugs: [a], note: "x".repeat(281) })).status).toBe(400);
    expect((await call(A, "POST", "/shares", { recipeSlugs: Array.from({ length: 101 }, (_, i) => `r${i}`) })).status).toBe(400);
    // Another household's recipe can't be put in a set, even mixed with your own.
    expect((await call(A, "POST", "/shares", { recipeSlugs: [a, b] })).status).toBe(400);
    expect((await call("", "POST", "/shares", { recipeSlugs: [a] })).status).toBe(401);
  });

  it("recipe links carry the name and note too, and the old route still works", async () => {
    const { A, call, pub, json, recipe } = await mk();
    const a = await recipe("Soup");
    const t = token((await json(await call(A, "POST", `/recipes/${a}/shares`, { note: "So good" }))).url);
    const s = await json(await pub(`/shares/${t}`));
    expect(s).toMatchObject({ kind: "recipe", title: "Soup", note: "So good", sharedBy: "n", count: 1 });
    expect(s.recipe.name).toBe("Soup");
    expect((await pub(`/recipes/${t}`)).status).toBe(200);
    // A set token is not a single-recipe token.
    const st = token((await json(await call(A, "POST", "/shares", { recipeSlugs: [a] }))).url);
    expect((await pub(`/recipes/${st}`)).status).toBe(404);
  });

  it("shares a cookbook live: manual order, smart filter as the sharer, and 404 with cookbooks off", async () => {
    const { o, A, B, call, pub, json, recipe } = await mk();
    const soup = await recipe("Pea soup");
    const tart = await recipe("Tart");
    await call(A, "POST", "/cookbooks", { name: "Faves", kind: "manual" });
    await call(A, "POST", "/cookbooks/faves/recipes", { slug: tart });
    await call(A, "POST", "/cookbooks/faves/recipes", { slug: soup });
    const mt = token((await json(await call(A, "POST", "/cookbooks/faves/shares", {}))).url);
    let s = await json(await pub(`/shares/${mt}`));
    expect(s).toMatchObject({ kind: "cookbook", title: "Faves", count: 2 });
    expect(s.items.map((i: any) => i.slug)).toEqual([tart, soup]);
    await call(A, "DELETE", `/cookbooks/faves/recipes/${tart}`);
    expect((await json(await pub(`/shares/${mt}`))).count).toBe(1);

    await call(A, "PUT", `/recipes/${tart}/me`, { favourite: true });
    await call(A, "POST", "/cookbooks", { name: "Loved", kind: "smart", filter: { favourites: true } });
    const st = token((await json(await call(A, "POST", "/cookbooks/loved/shares", {}))).url);
    s = await json(await pub(`/shares/${st}`));
    expect(s.items.map((i: any) => i.slug)).toEqual([tart]);
    expect((await pub(`/shares/${st}/recipes/${soup}`)).status).toBe(404);
    // If the sharer's account is gone, a favourites cookbook shows nothing rather than the whole library.
    await o.db.update(shareLinks).set({ createdBy: null });
    expect((await json(await pub(`/shares/${st}`))).count).toBe(0);

    expect((await call(B, "POST", "/cookbooks/faves/shares", {})).status).toBe(404);
    await call(A, "DELETE", "/cookbooks/faves");
    expect((await pub(`/shares/${mt}`)).status).toBe(404);

    const off = await mk({ MEALLY_FEATURE_COOKBOOKS: "off" });
    expect((await off.call(off.A, "POST", "/cookbooks/x/shares", {})).status).toBe(404);
  });

  it("lists every active link of the household only, and revokes any kind", async () => {
    const { A, B, call, pub, json, recipe } = await mk();
    const a = await recipe("Soup");
    await call(A, "POST", `/recipes/${a}/shares`, {});
    const t = token((await json(await call(A, "POST", "/shares", { recipeSlugs: [a], title: "Mine" }))).url);
    await call(A, "POST", "/cookbooks", { name: "Book", kind: "manual" });
    await call(A, "POST", "/cookbooks/book/shares", {});
    const list = (await json(await call(A, "GET", "/shares"))).items;
    expect(list.map((l: any) => [l.kind, l.title, l.targetSlug, l.count])).toEqual([
      ["cookbook", "Book", "book", null],
      ["set", "Mine", null, 1],
      ["recipe", "Soup", a, null],
    ]);
    expect(JSON.stringify(list)).not.toContain(t);
    expect((await json(await call(B, "GET", "/shares"))).items).toEqual([]);
    const set = list.find((l: any) => l.kind === "set");
    expect((await call(B, "DELETE", `/shares/${set.id}`)).status).toBe(404);
    expect((await call(A, "DELETE", `/shares/${set.id}`)).status).toBe(204);
    expect((await pub(`/shares/${t}`)).status).toBe(404);
    expect((await call("", "GET", "/shares")).status).toBe(401);
  });

  it("serves set images only for recipes in the set", async () => {
    const { A, app, call, pub, json, recipe } = await mk();
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#3c3" } }).png().toBuffer();
    const pic = await recipe("Pic");
    const other = await recipe("Other pic");
    for (const s of [pic, other]) {
      const form = new FormData();
      form.set("file", new File([new Uint8Array(png)], "x.png", { type: "image/png" }));
      await app.request(`/api/v1/recipes/${s}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: A }, body: form });
    }
    const t = token((await json(await call(A, "POST", "/shares", { recipeSlugs: [pic] }))).url);
    const s = await json(await pub(`/shares/${t}`));
    expect(s.items[0].imageUrl).toBe(`/api/v1/public/shares/${t}/recipes/${pic}/image/320`);
    expect((await app.request(s.items[0].imageUrl)).status).toBe(200);
    expect((await pub(`/shares/${t}/recipes/${other}/image/320`)).status).toBe(404);
    expect((await pub(`/shares/${t}/recipes/${pic}/image/999`)).status).toBe(404);
  });
});
