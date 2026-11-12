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
  const ck = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
  const A = ck((await call(undefined, "POST", "/auth/setup", { email: "a@example.com", name: "A", password: "correct horse" })).res);
  const B = ck((await call(undefined, "POST", "/auth/register", { email: "b@example.com", name: "B", password: "correct horse" })).res);
  return { call, A, B };
}

describe("favourites and ratings", () => {
  it("toggles per user, reports the rating, filters and sorts", async () => {
    const { call, A, B } = await mk();
    for (const n of ["Soup", "Tart", "Pie"]) await call(A, "POST", "/recipes", { name: n });
    expect((await call(A, "GET", "/recipes/soup")).body.me).toEqual({ favourite: false, rating: null });
    expect((await call(A, "PUT", "/recipes/soup/me", { favourite: true, rating: 5 })).body).toEqual({ favourite: true, rating: 5 });
    // a partial update leaves the other field alone
    expect((await call(A, "PUT", "/recipes/soup/me", { rating: 4 })).body).toEqual({ favourite: true, rating: 4 });
    expect((await call(B, "PUT", "/recipes/soup/me", { rating: 5 })).status).toBe(404);
    const r = (await call(A, "GET", "/recipes/soup")).body;
    expect(r.me).toEqual({ favourite: true, rating: 4 });
    expect(r.householdRating).toEqual({ average: 4, count: 1 });
    // clearing
    expect((await call(A, "PUT", "/recipes/soup/me", { rating: null })).body.rating).toBeNull();
    expect((await call(A, "GET", "/recipes/soup")).body.householdRating).toEqual({ average: null, count: 0 });
    await call(A, "PUT", "/recipes/soup/me", { rating: 4 });
    expect((await call(A, "PUT", "/recipes/soup/me", { rating: 6 })).status).toBe(400);
    expect((await call(A, "PUT", "/recipes/soup/me", {})).status).toBe(400);

    await call(A, "PUT", "/recipes/tart/me", { rating: 3 });
    const list = (await call(A, "GET", "/recipes?sort=rating")).body.items;
    expect(list.map((i: any) => [i.slug, i.rating, i.favourite])).toEqual([["soup", 4, true], ["tart", 3, false], ["pie", null, false]]);
    const page1 = (await call(A, "GET", "/recipes?sort=rating&limit=2")).body;
    expect(page1.items.map((i: any) => i.slug)).toEqual(["soup", "tart"]);
    expect((await call(A, "GET", `/recipes?sort=rating&limit=2&cursor=${page1.nextCursor}`)).body.items.map((i: any) => i.slug)).toEqual(["pie"]);
    expect((await call(A, "GET", "/recipes?favourites=1")).body.items.map((i: any) => i.slug)).toEqual(["soup"]);
    expect((await call(A, "GET", "/recipes?minRating=4")).body.items.map((i: any) => i.slug)).toEqual(["soup"]);
    expect((await call(B, "GET", "/recipes?favourites=1")).body.items).toEqual([]);
  });

  it("does not let another user rate a recipe (404)", async () => {
    const { call, A } = await mk({ MEALLY_SIGNUP_MODE: "open" });
    await call(A, "POST", "/recipes", { name: "Soup" });
    const other = (await call(undefined, "POST", "/auth/register", { email: "z@example.com", name: "Z", password: "correct horse" })).res;
    const Z = other.headers.get("set-cookie")!.split(";")[0]!;
    expect((await call(Z, "PUT", "/recipes/soup/me", { rating: 5 })).status).toBe(404);
    expect((await call(A, "GET", "/recipes/soup")).body.householdRating.count).toBe(0);
  });

  it("is ignored when the flag is off", async () => {
    const { call, A } = await mk({ MEALLY_FEATURE_RATINGS: "off" });
    await call(A, "POST", "/recipes", { name: "Soup" });
    expect((await call(A, "PUT", "/recipes/soup/me", { rating: 5 })).status).toBe(404);
    const r = (await call(A, "GET", "/recipes/soup")).body;
    expect(r.me).toBeUndefined();
    expect(r.householdRating).toBeUndefined();
    const l = (await call(A, "GET", "/recipes?favourites=1&minRating=4&sort=rating")).body.items;
    expect(l).toHaveLength(1);
    expect(l[0].favourite).toBeUndefined();
  });
});
