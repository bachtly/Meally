import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";
import { createNodePlatform } from "../../adapters/node/index.js";
import { createSupabaseImageStore } from "../../adapters/supabase/images.js";
import { createEdgePlatform } from "../../adapters/edge/index.js";
import type { Platform } from "../../ports/index.js";
import { safeEqual } from "./routes.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };
const SECRET = "s3cret-value";

async function mk(platformOver?: (p: Platform) => Platform, env: Record<string, string> = { MEALLY_SIGNUP_MODE: "open", MEALLY_JOBS_SECRET: SECRET }) {
  const o = openTestDb();
  const base = createNodePlatform({ dataDir: "./.vdata-test-unused", scryptLogN: 10 });
  const platform = platformOver ? platformOver(base) : base;
  const app = createApp({ db: o.db, env, platform });
  await o.ready;
  const su = async (p: string, email: string) =>
    (await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password: "correct horse" }) })).headers.get("set-cookie")!.split(";")[0]!;
  return { app, platform, su };
}

describe("jobs route auth", () => {
  const post = (t: Awaited<ReturnType<typeof mk>>, name: string, auth?: string) =>
    t.app.request(`/api/v1/internal/jobs/${name}`, { method: "POST", headers: auth ? { authorization: auth } : {} });

  it("rejects missing and wrong secrets with 401 and runs the job with the right one", async () => {
    const t = await mk();
    const ran = vi.fn();
    t.platform.scheduler.define("test.job", ran);
    expect((await post(t, "test.job")).status).toBe(401);
    expect((await post(t, "test.job", "Bearer nope")).status).toBe(401);
    expect((await post(t, "test.job", SECRET)).status).toBe(401);
    expect(ran).not.toHaveBeenCalled();
    expect((await post(t, "test.job", `Bearer ${SECRET}`)).status).toBe(200);
    expect(ran).toHaveBeenCalledTimes(1);
    expect((await post(t, "nope", `Bearer ${SECRET}`)).status).toBe(404);
  });

  it("is closed when no secret is configured", async () => {
    const t = await mk(undefined, { MEALLY_SIGNUP_MODE: "open" });
    expect((await post(t, "shares.cleanup", "Bearer anything")).status).toBe(401);
  });

  it("registers the standard jobs, with import.run a safe no-op and shares.cleanup re-entrant", async () => {
    const t = await mk(() => createEdgePlatform({ pbkdf2Iterations: 1000 }));
    for (const n of ["import.run", "shares.cleanup", "webhooks.retry", "mealplan.digest"]) expect((await post(t, n, `Bearer ${SECRET}`)).status).toBe(200);
    const both = await Promise.all([post(t, "shares.cleanup", `Bearer ${SECRET}`), post(t, "shares.cleanup", `Bearer ${SECRET}`)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
  });

  it("compares secrets without short-circuiting", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("meta and ETag polling", () => {
  it("reports streaming off on the edge platform and on on Node", async () => {
    const edge = await mk(() => createEdgePlatform({ pbkdf2Iterations: 1000 }));
    expect(await (await edge.app.request("/api/v1/meta")).json()).toMatchObject({ streaming: false, presizedImages: false });
    const node = await mk();
    expect(await (await node.app.request("/api/v1/meta")).json()).toMatchObject({ streaming: true, presizedImages: false });
  });

  it("answers 304 to If-None-Match on shopping lists until something changes", async () => {
    const t = await mk();
    const cookie = await t.su("setup", "a@example.com");
    const h = { ...H, cookie };
    const list = (await (await t.app.request("/api/v1/shopping/lists", { method: "POST", headers: h, body: JSON.stringify({ name: "Weekly" }) })).json()) as { id: string };
    const get = (etag?: string) => t.app.request(`/api/v1/shopping/lists/${list.id}`, { headers: { ...h, ...(etag ? { "if-none-match": etag } : {}) } });
    const etag = (await get()).headers.get("etag")!;
    expect(etag).toBeTruthy();
    expect((await get(etag)).status).toBe(304);
    await t.app.request(`/api/v1/shopping/lists/${list.id}/items`, { method: "POST", headers: h, body: JSON.stringify({ text: "milk" }) });
    const after = await get(etag);
    expect(after.status).toBe(200);
    expect(after.headers.get("etag")).not.toBe(etag);
  });
});

describe("Supabase image store", () => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fake = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body });
    if (url.includes("/object/sign/")) return Response.json({ signedURL: "/object/sign/meally-images/x?token=T" });
    return new Response("ok");
  }) as unknown as typeof fetch;
  const store = () => createSupabaseImageStore({ url: "https://abc.supabase.co/", serviceKey: "SRK", fetch: fake });

  it("records the Storage REST requests", async () => {
    calls.length = 0;
    const s = store();
    await s.put("hh", "img", 320, new Uint8Array([1]), "image/webp");
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://abc.supabase.co/storage/v1/object/meally-images/hh/img-320.webp" });
    expect(calls[0]!.headers).toMatchObject({ Authorization: "Bearer SRK", "x-upsert": "true", "Content-Type": "image/webp" });
    expect(await s.urlFor("hh", "img", 800)).toBe("https://abc.supabase.co/storage/v1/object/sign/meally-images/x?token=T");
    expect(JSON.parse(calls[1]!.body as string)).toEqual({ expiresIn: 60 });
    await s.delete("hh", "img");
    expect(calls[2]).toMatchObject({ method: "DELETE", url: "https://abc.supabase.co/storage/v1/object/meally-images" });
    expect(JSON.parse(calls[2]!.body as string).prefixes).toEqual(["hh/img-320.webp", "hh/img-800.webp", "hh/img-1600.webp"]);
  });

  const webp = () => new File([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80, 1])], "a.webp", { type: "image/webp" });

  it("takes pre-sized uploads, redirects to a signed URL, and keeps households apart", async () => {
    calls.length = 0;
    const t = await mk((p) => ({ ...p, images: store() }));
    const A = await t.su("setup", "a@example.com");
    const B = await t.su("register", "b@example.com");
    const made = await t.app.request("/api/v1/recipes", { method: "POST", headers: { ...H, cookie: A }, body: JSON.stringify({ name: "Soup", ingredients: [{ raw: "1 cup milk" }], steps: [{ text: "Stir" }] }) });
    const { slug } = (await made.json()) as { slug: string };
    const up = (parts: Record<string, File>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(parts)) fd.append(k, v);
      return t.app.request(`/api/v1/recipes/${slug}/image`, { method: "POST", headers: { "x-requested-with": "meally", cookie: A }, body: fd });
    };
    expect((await up({ file: webp() })).status).toBe(415); // the edge cannot resize originals
    expect((await up({ w320: webp(), w800: webp() })).status).toBe(400);
    expect((await up({ w320: webp(), w800: webp(), w1600: new File(["x"], "a.png", { type: "image/png" }) })).status).toBe(415);
    expect((await up({ w320: webp(), w800: webp(), w1600: new File([new Uint8Array(20)], "a.webp", { type: "image/webp" }) })).status).toBe(415);
    const ok = await up({ w320: webp(), w800: webp(), w1600: webp() });
    expect(ok.status).toBe(201);
    const recipe = (await ok.json()) as { imageUrl: string };
    expect(calls.filter((c) => c.method === "POST" && c.url.includes("/object/meally-images/"))).toHaveLength(3);
    const own = await t.app.request(recipe.imageUrl, { headers: { cookie: A } });
    expect(own.status).toBe(302);
    expect(own.headers.get("location")).toContain("token=T");
    expect((await t.app.request(recipe.imageUrl, { headers: { cookie: B } })).status).toBe(404);
  });
});
