import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openDb } from "../../db/index.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}, flags?: unknown) {
  const { db, ready } = openDb(":memory:");
  await ready;
  const app = createApp({ db, env: { MEALLY_SIGNUP_MODE: "invite", ...env }, scryptLogN: 10 });
  const call = async (cookie: string | undefined, method: string, path: string, data?: unknown) => {
    const res = await app.request(`/api/v1${path}`, { method, headers: cookie ? { ...H, cookie } : H, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: res.status, body: (await res.json().catch(() => null)) as any, res };
  };
  const ck = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
  const A = ck((await call(undefined, "POST", "/auth/setup", { email: "a@example.com", name: "Ann", password: "correct horse" })).res);
  const inv = (await call(A, "POST", "/household/invites", {})).body;
  const B = ck((await call(undefined, "POST", "/auth/register", { email: "b@example.com", name: "Bob", password: "correct horse", inviteToken: inv.token })).res);
  return { call, A, B, flags };
}

describe("timeline", () => {
  it("posts, lists, sets last_made_at and counts in the library", async () => {
    const { call, A, B } = await mk();
    await call(A, "POST", "/recipes", { name: "Soup" });
    await call(A, "POST", "/recipes", { name: "Tart" });
    expect((await call(A, "POST", "/recipes/soup/timeline", { kind: "comment" })).status).toBe(400);
    const made = await call(A, "POST", "/recipes/soup/timeline", { kind: "made", text: "Yum" });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ kind: "made", userName: "Ann", canEdit: true, canDelete: true });
    await call(B, "POST", "/recipes/soup/timeline", { kind: "comment", text: "Needs salt" });
    const list = (await call(A, "GET", "/recipes/soup/timeline")).body;
    expect(list.items.map((e: any) => e.kind)).toEqual(["comment", "made"]);
    expect(list.items[0]).toMatchObject({ canEdit: false, canDelete: true });
    const p1 = (await call(A, "GET", "/recipes/soup/timeline?limit=1")).body;
    expect(p1.items).toHaveLength(1);
    expect((await call(A, "GET", `/recipes/soup/timeline?limit=1&cursor=${p1.nextCursor}`)).body.items[0].kind).toBe("made");
    const rec = (await call(A, "GET", "/recipes?sort=last-made")).body.items;
    expect(rec.map((r: any) => [r.slug, r.madeCount])).toEqual([["soup", 1], ["tart", 0]]);
    expect(rec[0].lastMadeAt).toBeGreaterThan(0);
    expect(rec[1].lastMadeAt).toBeNull();
    const feed = (await call(B, "GET", "/timeline")).body.items;
    expect(feed).toHaveLength(2);
    expect(feed[0].recipeSlug).toBe("soup");
  });

  it("sets recipe_user_data.last_made_at and snapshots the rating", async () => {
    const { call, A } = await mk();
    await call(A, "POST", "/recipes", { name: "Soup" });
    await call(A, "PUT", "/recipes/soup/me", { rating: 4 });
    const ev = (await call(A, "POST", "/recipes/soup/timeline", { kind: "made" })).body;
    expect(ev.rating).toBe(4);
    expect((await call(A, "GET", "/recipes/soup")).body.me.rating).toBe(4);
  });

  it("enforces edit and delete permissions", async () => {
    const { call, A, B } = await mk();
    await call(A, "POST", "/recipes", { name: "Soup" });
    const e = (await call(B, "POST", "/recipes/soup/timeline", { kind: "note", text: "mine" })).body;
    expect((await call(A, "PATCH", `/timeline/${e.id}`, { text: "x" })).status).toBe(403);
    const ed = await call(B, "PATCH", `/timeline/${e.id}`, { text: "better" });
    expect(ed.body).toMatchObject({ text: "better" });
    expect(ed.body.editedAt).toBeGreaterThan(0);
    const e2 = (await call(A, "POST", "/recipes/soup/timeline", { kind: "comment", text: "owner" })).body;
    expect((await call(B, "DELETE", `/timeline/${e2.id}`)).status).toBe(403);
    expect((await call(A, "DELETE", `/timeline/${e.id}`)).status).toBe(204); // owner deletes a member's
    expect((await call(A, "DELETE", `/timeline/${e.id}`)).status).toBe(404);
  });

  it("isolates households and respects the flag", async () => {
    const { call, A } = await mk({ MEALLY_SIGNUP_MODE: "open" });
    await call(A, "POST", "/recipes", { name: "Soup" });
    const e = (await call(A, "POST", "/recipes/soup/timeline", { kind: "comment", text: "hi" })).body;
    const Z = (await call(undefined, "POST", "/auth/register", { email: "z@example.com", name: "Z", password: "correct horse" })).res.headers.get("set-cookie")!.split(";")[0]!;
    expect((await call(Z, "GET", "/recipes/soup/timeline")).status).toBe(404);
    expect((await call(Z, "POST", "/recipes/soup/timeline", { kind: "comment", text: "x" })).status).toBe(404);
    expect((await call(Z, "DELETE", `/timeline/${e.id}`)).status).toBe(404);
    expect((await call(Z, "GET", "/timeline")).body.items).toEqual([]);
  });

  it("is hidden when the flag is off", async () => {
    const { call, A } = await mk({ MEALLY_FEATURE_TIMELINE: "off" });
    await call(A, "POST", "/recipes", { name: "Soup" });
    expect((await call(A, "GET", "/recipes/soup/timeline")).status).toBe(404);
    expect((await call(A, "GET", "/timeline")).status).toBe(404);
    expect((await call(A, "GET", "/recipes")).body.items[0].madeCount).toBeUndefined();
  });
});
