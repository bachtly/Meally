import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-share-save-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk() {
  const o = openTestDb();
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open" }, scryptLogN: 10, dataDir });
  await o.ready;
  const su = async (p: string, email: string, name: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name, password: "correct horse" }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com", "Alice");
  const B = await su("register", "b@example.com", "Bob");
  const call = (cookie: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (r: Response) => (await r.json()) as any;
  const recipe = async (name: string) =>
    (await json(await call(A, "POST", "/recipes", { name, sourceUrl: "https://example.org/x", ingredients: [{ raw: "1 cup milk", quantity: 1, unit: "cup", food: "milk" }], steps: [{ text: "Stir" }] })))
      .slug as string;
  const withImage = async (slug: string) => {
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#c33" } }).png().toBuffer();
    const form = new FormData();
    form.set("file", new File([new Uint8Array(png)], "x.png", { type: "image/png" }));
    await app.request(`/api/v1/recipes/${slug}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: A }, body: form });
  };
  const setLink = async (slugs: string[], extra: object = {}) => (await json(await call(A, "POST", "/shares", { recipeSlugs: slugs, ...extra }))).url.split("/s/")[1] as string;
  return { app, A, B, call, json, recipe, withImage, setLink };
}

describe("saving a share", () => {
  it("copies recipes with their image into the viewer's household, with who shared them", async () => {
    const { app, A, B, call, json, recipe, withImage, setLink } = await mk();
    const pie = await recipe("Pie");
    await withImage(pie);
    const t = await setLink([pie]);
    const res = await call(B, "POST", `/shares/received/${t}/save`, { slugs: [pie] });
    expect(res.status).toBe(201);
    const { saved, cookbookSlug } = await json(res);
    expect(cookbookSlug).toBeNull();
    const mine = await json(await call(B, "GET", `/recipes/${saved[pie]}`));
    expect(mine).toMatchObject({ name: "Pie", sourceUrl: "https://example.org/x", savedFrom: { name: "Alice" } });
    expect(mine.ingredients[0]).toMatchObject({ raw: "1 cup milk", quantity: 1, unit: "cup", food: "milk" });
    expect(mine.steps[0].text).toBe("Stir");
    expect(JSON.stringify(mine)).not.toContain("origin");
    // The image is the viewer's own file, served through their own image route.
    const img = await app.request(mine.imageUrl, { headers: { cookie: B } });
    expect(img.status).toBe(200);
    // A copy, not a link: editing it leaves the original alone.
    expect((await call(B, "PUT", `/recipes/${saved[pie]}`, { name: "Bob's pie", ingredients: [], steps: [] })).status).toBe(200);
    expect((await json(await call(A, "GET", `/recipes/${pie}`))).name).toBe("Pie");
    expect((await json(await call(A, "GET", `/recipes/${pie}`))).savedFrom).toBeNull();
  });

  it("doesn't copy twice, and reports what the viewer already has", async () => {
    const { B, call, json, recipe, setLink } = await mk();
    const a = await recipe("Soup");
    const b = await recipe("Stew");
    const t = await setLink([a, b]);
    expect(await json(await call(B, "GET", `/shares/received/${t}`))).toEqual({ sameHousehold: false, saved: {} });
    const first = (await json(await call(B, "POST", `/shares/received/${t}/save`, { slugs: [a] }))).saved;
    const again = (await json(await call(B, "POST", `/shares/received/${t}/save`, { slugs: [a, b] }))).saved;
    expect(again[a]).toBe(first[a]);
    expect((await json(await call(B, "GET", "/recipes?limit=50"))).items).toHaveLength(2);
    expect((await json(await call(B, "GET", `/shares/received/${t}`))).saved).toEqual(again);
  });

  it("puts a batch in a new cookbook, then later batches in the same one", async () => {
    const { B, call, json, recipe, setLink } = await mk();
    const a = await recipe("One");
    const b = await recipe("Two");
    const t = await setLink([a, b], { title: "Weekend" });
    const r1 = await json(await call(B, "POST", `/shares/received/${t}/save`, { slugs: [a], cookbook: { name: "Weekend" } }));
    expect(r1.cookbookSlug).toBe("weekend");
    await call(B, "POST", `/shares/received/${t}/save`, { slugs: [b], cookbook: { slug: r1.cookbookSlug } });
    const items = (await json(await call(B, "GET", "/cookbooks/weekend/recipes"))).items;
    expect(items.map((i: any) => i.name)).toEqual(["One", "Two"]);
  });

  it("keeps the sharer anonymous when they hid their name", async () => {
    const { B, call, json, recipe, setLink } = await mk();
    const a = await recipe("Soup");
    const t = await setLink([a], { showName: false });
    const { saved } = await json(await call(B, "POST", `/shares/received/${t}/save`, { slugs: [a] }));
    expect((await json(await call(B, "GET", `/recipes/${saved[a]}`))).savedFrom).toMatchObject({ name: null });
  });

  it("refuses own-household saves, recipes outside the link, dead links, bad bodies and anonymous callers", async () => {
    const { A, B, call, json, recipe, setLink } = await mk();
    const a = await recipe("Soup");
    const outside = await recipe("Secret");
    const t = await setLink([a]);
    expect(await json(await call(A, "GET", `/shares/received/${t}`))).toEqual({ sameHousehold: true, saved: { [a]: a } });
    expect((await call(A, "POST", `/shares/received/${t}/save`, { slugs: [a] })).status).toBe(409);
    expect((await call(B, "POST", `/shares/received/${t}/save`, { slugs: [outside] })).status).toBe(404);
    expect((await call(B, "POST", `/shares/received/${t}/save`, { slugs: [] })).status).toBe(400);
    expect((await call(B, "POST", `/shares/received/${t}/save`, { slugs: Array.from({ length: 11 }, () => a) })).status).toBe(400);
    expect((await call("", "POST", `/shares/received/${t}/save`, { slugs: [a] })).status).toBe(401);
    expect((await call(B, "GET", `/shares/received/nonsense`)).status).toBe(404);
    const [link] = (await json(await call(A, "GET", "/shares"))).items;
    await call(A, "DELETE", `/shares/${link.id}`);
    expect((await call(B, "POST", `/shares/received/${t}/save`, { slugs: [a] })).status).toBe(404);
    // Nothing was written to B's household along the way.
    expect((await json(await call(B, "GET", "/recipes?limit=50"))).items).toEqual([]);
  });
});
