import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { hashToken } from "./service.js";
import { openDb } from "../../db/index.js";
import { shareLinks } from "../../db/schema/index.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-share-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const o = openDb(":memory:");
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
    await o.client.execute("UPDATE share_links SET expires_at = 1000 WHERE revoked_at IS NULL");
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
    const off = await mk({ MEALLY_FEATURE_SHARE_LINKS: "off" });
    expect((await off.pub(`/recipes/${token}`)).status).toBe(404);
    const s2 = await off.recipe("Soup");
    expect((await off.call(off.A, "POST", `/recipes/${s2}/shares`, {})).status).toBe(404);
    expect((await pub(`/recipes/${token}`)).status).toBe(200);
    void A; void call;
  });
});
