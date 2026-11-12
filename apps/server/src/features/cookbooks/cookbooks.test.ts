import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const { db, ready } = openTestDb();
  await ready;
  const app = createApp({ db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10 });
  const call = async (cookie: string | undefined, method: string, path: string, data?: unknown) => {
    const res = await app.request(`/api/v1${path}`, { method, headers: cookie ? { ...H, cookie } : H, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };
  const reg = async (email: string) =>
    (await call(undefined, "POST", "/auth/register", { email, name: email, password: "correct horse" })).res.headers.get("set-cookie")!.split(";")[0]!;
  const setup = (await call(undefined, "POST", "/auth/setup", { email: "a@example.com", name: "A", password: "correct horse" })).res;
  const A = setup.headers.get("set-cookie")!.split(";")[0]!;
  return { call, A, reg };
}
const slugs = (r: any) => r.body.items.map((i: any) => i.slug);

describe("cookbooks", () => {
  it("smart cookbooks resolve like the library filter", async () => {
    const { call, A } = await mk();
    await call(A, "POST", "/recipes", { name: "Soup", tags: ["quick"] });
    await call(A, "POST", "/recipes", { name: "Stew", tags: ["slow"] });
    await call(A, "POST", "/recipes", { name: "Tart", tags: ["quick"] });
    await call(A, "PUT", "/recipes/tart/me", { favourite: true });
    const filter = { tag: ["quick"], favourites: true };
    const cb = await call(A, "POST", "/cookbooks", { name: "Quick favs", kind: "smart", filter });
    expect(cb.status).toBe(201);
    expect(cb.body.slug).toBe("quick-favs");
    expect(cb.body.count).toBe(1);
    const lib = await call(A, "GET", "/recipes?tag=quick&favourites=1");
    expect(slugs(await call(A, "GET", "/cookbooks/quick-favs/recipes"))).toEqual(slugs(lib));
    expect(slugs(lib)).toEqual(["tart"]);
    // editing the filter changes the result
    await call(A, "PUT", "/cookbooks/quick-favs", { filter: { tag: ["quick"] } });
    expect(slugs(await call(A, "GET", "/cookbooks/quick-favs/recipes")).sort()).toEqual(["soup", "tart"]);
    // smart lists cannot be edited by hand
    expect((await call(A, "POST", "/cookbooks/quick-favs/recipes", { slug: "soup" })).status).toBe(409);
  });

  it("manual cookbooks keep their order and paginate", async () => {
    const { call, A } = await mk();
    for (const n of ["A", "B", "C"]) await call(A, "POST", "/recipes", { name: n });
    await call(A, "POST", "/cookbooks", { name: "Mine", kind: "manual" });
    for (const s of ["c", "a", "b"]) expect((await call(A, "POST", "/cookbooks/mine/recipes", { slug: s })).status).toBe(204);
    await call(A, "POST", "/cookbooks/mine/recipes", { slug: "a" }); // duplicate is a no-op
    expect(slugs(await call(A, "GET", "/cookbooks/mine/recipes"))).toEqual(["c", "a", "b"]);
    const p1 = (await call(A, "GET", "/cookbooks/mine/recipes?limit=2")).body;
    expect(p1.items.map((i: any) => i.slug)).toEqual(["c", "a"]);
    expect(slugs(await call(A, "GET", `/cookbooks/mine/recipes?limit=2&cursor=${p1.nextCursor}`))).toEqual(["b"]);
    expect((await call(A, "PUT", "/cookbooks/mine/order", { slugs: ["b", "c", "a"] })).status).toBe(204);
    expect(slugs(await call(A, "GET", "/cookbooks/mine/recipes"))).toEqual(["b", "c", "a"]);
    expect((await call(A, "GET", "/cookbooks/containing/a")).body.items).toEqual(["mine"]);
    await call(A, "DELETE", "/cookbooks/mine/recipes/c");
    expect(slugs(await call(A, "GET", "/cookbooks/mine/recipes"))).toEqual(["b", "a"]);
    expect((await call(A, "GET", "/cookbooks/mine")).body.count).toBe(2);
  });

  it("does CRUD with unique slugs and reorders cookbooks", async () => {
    const { call, A } = await mk();
    await call(A, "POST", "/cookbooks", { name: "Soups", kind: "manual" });
    expect((await call(A, "POST", "/cookbooks", { name: "Soups", kind: "manual" })).body.slug).toBe("soups-2");
    expect((await call(A, "POST", "/cookbooks", { name: "", kind: "manual" })).status).toBe(400);
    const u = await call(A, "PUT", "/cookbooks/soups", { name: "Winter", description: "Warm" });
    expect(u.body).toMatchObject({ slug: "winter", description: "Warm", kind: "manual" });
    await call(A, "PUT", "/cookbooks/order", { slugs: ["soups-2", "winter"] });
    expect((await call(A, "GET", "/cookbooks")).body.items.map((i: any) => i.slug)).toEqual(["soups-2", "winter"]);
    expect((await call(A, "DELETE", "/cookbooks/winter")).status).toBe(204);
    expect((await call(A, "GET", "/cookbooks/winter")).status).toBe(404);
  });

  it("is isolated per user", async () => {
    const { call, A, reg } = await mk();
    const Z = await reg("z@example.com");
    await call(A, "POST", "/recipes", { name: "Soup" });
    await call(A, "POST", "/cookbooks", { name: "Mine", kind: "manual" });
    expect((await call(Z, "GET", "/cookbooks/mine")).status).toBe(404);
    expect((await call(Z, "GET", "/cookbooks/mine/recipes")).status).toBe(404);
    expect((await call(Z, "DELETE", "/cookbooks/mine")).status).toBe(404);
    expect((await call(Z, "GET", "/cookbooks")).body.items).toEqual([]);
    await call(Z, "POST", "/cookbooks", { name: "Zed", kind: "manual" });
    expect((await call(Z, "POST", "/cookbooks/zed/recipes", { slug: "soup" })).status).toBe(404);
  });

  it("is hidden when the flag is off", async () => {
    const { call, A } = await mk({ MEALLY_FEATURE_COOKBOOKS: "off" });
    expect((await call(A, "GET", "/cookbooks")).status).toBe(404);
  });
});
