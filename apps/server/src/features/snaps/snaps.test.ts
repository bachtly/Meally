import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { friendships, images, pushDeliveries, pushSubscriptions, reactions, recipes, snaps } from "../../db/schema/index.js";
import { openTestDb } from "../../db/testing.js";
import { createLimiter } from "./service.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-snaps-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const o = openTestDb();
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, dataDir });
  await o.ready;
  const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
  const reg = async (path: "setup" | "register", email: string, name: string) => {
    const res = await app.request(`/api/v1/auth/${path}`, { method: "POST", headers: H, body: JSON.stringify({ email, name, password: "correct horse" }) });
    if (!res.headers.get("set-cookie")) throw new Error(`${path} ${res.status} ${await res.text()}`);
    return cookieOf(res);
  };
  const png = await sharp({ create: { width: 1200, height: 900, channels: 3, background: "#c33" } }).png().toBuffer();
  const json = async (res: Response) => {
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
  const call = async (cookie: string, method: string, p: string, body?: unknown) =>
    json(await app.request(`/api/v1${p}`, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined }));
  const send = async (cookie: string, fields: Record<string, string>, file: Buffer | null = png) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (file) form.set("file", new File([new Uint8Array(file)], "x.png", { type: "image/png" }));
    return json(await app.request("/api/v1/snaps", { method: "POST", headers: { cookie, "x-requested-with": "meally" }, body: form }));
  };
  const A = await reg("setup", "a@example.com", "Ann");
  const B = await reg("register", "b@example.com", "Bo");
  const C = await reg("register", "c@example.com", "Cy");
  const id = async (cookie: string) => (await call(cookie, "GET", "/auth/me")).body.user.id as string;
  const link = async (x: string, y: string, status: "accepted" | "pending") => {
    const [a, b] = [await id(x), await id(y)].sort() as [string, string];
    const now = new Date();
    await o.db.insert(friendships).values({ userAId: a, userBId: b, status, requestedBy: a, createdAt: now, acceptedAt: status === "accepted" ? now : null });
  };
  const befriend = (x: string, y: string) => link(x, y, "accepted");
  const recipe = async (cookie: string, name: string) => (await call(cookie, "POST", "/recipes", { name })).body;
  return { o, app, A, B, C, call, send, befriend, link, id, recipe };
}

const imageFiles = () =>
  fs.existsSync(path.join(dataDir, "images")) ? fs.readdirSync(path.join(dataDir, "images")).flatMap((d) => fs.readdirSync(path.join(dataDir, "images", d))) : [];

describe("send a Snap", () => {
  it("stores the Snap, dedupes a retry by clientId, and serves its image with an immutable cache", async () => {
    const { o, app, A, send } = await mk();
    const r1 = await send(A, { clientId: "c1", caption: " nice ", dishName: "Pasta" });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ caption: "nice", dishName: "Pasta", place: null, recipe: null, author: { name: "Ann" }, myReactions: [], reactions: [] });
    const r2 = await send(A, { clientId: "c1" });
    expect(r2.status).toBe(200);
    expect(r2.body.id).toBe(r1.body.id);
    expect(await o.db.select().from(snaps)).toHaveLength(1);
    expect(await o.db.select().from(images)).toHaveLength(1);
    expect(r1.body.imageUrl).toMatch(/^\/api\/v1\/snaps\/.+\/images\/.+\/800$/);
    const img = await app.request(r1.body.imageUrl, { headers: { cookie: A } });
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(img.headers.get("content-type")).toBe("image/webp");
    const thumb = await app.request(r1.body.thumbUrl, { headers: { cookie: A } });
    expect((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).width).toBe(320);
  });

  it("when sends race on one clientId there is one Snap, one image row, and the losers delete their files", async () => {
    const { o, A, send } = await mk();
    const before = imageFiles().length;
    const rs = await Promise.all([send(A, { clientId: "race" }), send(A, { clientId: "race" }), send(A, { clientId: "race" })]);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(new Set(rs.map((r) => r.body.id)).size).toBe(1);
    expect(await o.db.select().from(snaps)).toHaveLength(1);
    expect(await o.db.select().from(images)).toHaveLength(1);
    const [row] = await o.db.select().from(snaps);
    expect(imageFiles().filter((f) => f.startsWith(row!.imageId))).toHaveLength(3);
    expect(imageFiles().length).toBe(before + 3);
  });

  it("rejects bad fields and bad images", async () => {
    const { A, send } = await mk();
    expect((await send(A, {})).status).toBe(400);
    expect((await send(A, { clientId: "x", caption: "a".repeat(2001) })).status).toBe(400);
    expect((await send(A, { clientId: "y" }, null)).status).toBe(400);
    expect((await send(A, { clientId: "z" }, Buffer.from("not an image"))).status).toBe(415);
  });

  it("links only the sender's own recipe: another user's recipe is a 404 and stores nothing", async () => {
    const { o, A, B, send, recipe } = await mk();
    const mine = await recipe(A, "Soup");
    const theirs = await recipe(B, "Stew");
    const ok = await send(A, { clientId: "r1", recipeId: mine.id });
    expect(ok.status).toBe(201);
    expect(ok.body.recipe).toEqual({ slug: mine.slug, name: "Soup" });
    const before = imageFiles().length;
    const bad = await send(A, { clientId: "r2", recipeId: theirs.id });
    expect(bad.status).toBe(404);
    expect(await o.db.select().from(snaps)).toHaveLength(1);
    expect(await o.db.select().from(images)).toHaveLength(1);
    expect(imageFiles().length).toBe(before);
  });

  it("requires sign-in", async () => {
    const { app } = await mk();
    expect((await app.request("/api/v1/snaps", { headers: { "x-requested-with": "meally" } })).status).toBe(401);
  });

  it("is a 404 feature_disabled when the flag is off", async () => {
    const { A, call } = await mk({ MEALLY_FEATURE_SNAPS: "off" });
    const r = await call(A, "GET", "/snaps");
    expect(r.status).toBe(404);
    expect(r.body.error).toBe("feature_disabled");
  });
});

describe("Feed and reads", () => {
  it("shows own and accepted Friends' Snaps, newest first, with keyset paging", async () => {
    const { A, B, C, send, call, befriend } = await mk();
    await befriend(A, B);
    const a1 = await send(A, { clientId: "1" });
    await new Promise((r) => setTimeout(r, 5));
    const b1 = await send(B, { clientId: "1" });
    await new Promise((r) => setTimeout(r, 5));
    const c1 = await send(C, { clientId: "1" });
    await new Promise((r) => setTimeout(r, 5));
    const a2 = await send(A, { clientId: "2" });
    const feed = await call(A, "GET", "/snaps");
    expect(feed.body.items.map((s: any) => s.id)).toEqual([a2.body.id, b1.body.id, a1.body.id]);
    expect(feed.body.nextCursor).toBeNull();
    const p1 = await call(A, "GET", "/snaps?limit=2");
    expect(p1.body.items).toHaveLength(2);
    expect(p1.body.nextCursor).not.toBeNull();
    const p2 = await call(A, "GET", `/snaps?limit=2&cursor=${p1.body.nextCursor}`);
    expect(p2.body.items.map((s: any) => s.id)).toEqual([a1.body.id]);
    expect(p2.body.nextCursor).toBeNull();
    expect((await call(C, "GET", "/snaps")).body.items.map((s: any) => s.id)).toEqual([c1.body.id]);
    expect((await call(A, "GET", "/snaps?cursor=zzz")).status).toBe(400);
  });

  it("a Friend reads the Snap and its image; a non-friend, a pending Friendship and a removed Friend get 404", async () => {
    const { app, A, B, C, send, call, befriend, link, id } = await mk();
    const s = (await send(A, { clientId: "s" })).body;
    const image = (cookie: string) => app.request(s.imageUrl, { headers: { cookie } });
    // non-friend
    expect((await call(B, "GET", `/snaps/${s.id}`)).status).toBe(404);
    expect((await image(B)).status).toBe(404);
    expect((await call(B, "GET", "/snaps")).body.items).toEqual([]);
    // pending
    await link(A, C, "pending");
    expect((await call(C, "GET", `/snaps/${s.id}`)).status).toBe(404);
    expect((await image(C)).status).toBe(404);
    expect((await call(C, "GET", "/snaps")).body.items).toEqual([]);
    // accepted, then removed
    await befriend(A, B);
    const seen = await call(B, "GET", `/snaps/${s.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.reactions).toBeUndefined();
    expect((await image(B)).status).toBe(200);
    expect((await call(B, "DELETE", `/friends/${await id(A)}`)).status).toBe(204);
    expect((await call(B, "GET", `/snaps/${s.id}`)).status).toBe(404);
    expect((await image(B)).status).toBe(404);
    expect((await call(B, "GET", "/snaps")).body.items).toEqual([]);
  });

  it("serves an image only under the Snap's own image id and a valid size", async () => {
    const { A, app, send } = await mk();
    const s = (await send(A, { clientId: "s" })).body;
    const other = (await send(A, { clientId: "t" })).body;
    const mixed = s.imageUrl.replace(/\/images\/[^/]+\//, `/images/${other.imageUrl.split("/")[6]}/`);
    expect((await app.request(mixed, { headers: { cookie: A } })).status).toBe(404);
    expect((await app.request(s.imageUrl.replace(/800$/, "999"), { headers: { cookie: A } })).status).toBe(404);
  });

  it("shows the author every live Reaction and everyone else only their own", async () => {
    const { o, A, B, send, call, befriend, id } = await mk();
    await befriend(A, B);
    const s = (await send(A, { clientId: "s" })).body;
    const now = new Date();
    await o.db.insert(reactions).values([
      { snapId: s.id, userId: await id(B), emoji: "heart", createdAt: now },
      { snapId: s.id, userId: await id(B), emoji: "yum", createdAt: now, removedAt: now },
    ]);
    const mine = (await call(A, "GET", `/snaps/${s.id}`)).body;
    expect(mine.reactions).toEqual([{ userId: await id(B), name: "Bo", emoji: "heart" }]);
    expect(mine.myReactions).toEqual([]);
    const theirs = (await call(B, "GET", `/snaps/${s.id}`)).body;
    expect(theirs.reactions).toBeUndefined();
    expect(theirs.myReactions).toEqual(["heart"]);
  });
});

describe("Reactions", () => {
  const sub = async (o: Awaited<ReturnType<typeof mk>>["o"], userId: string) =>
    o.db.insert(pushSubscriptions).values({ id: `sub-${userId}`, userId, endpoint: `https://push/${userId}`, p256dh: "k", auth: "a", createdAt: new Date() });

  it("lets a Friend react; the author sees all, everyone else only their own", async () => {
    const { A, B, C, send, call, befriend, id } = await mk();
    await befriend(A, B);
    await befriend(A, C);
    const s = (await send(A, { clientId: "s" })).body;
    const put = await call(B, "PUT", `/snaps/${s.id}/reactions/yum`);
    expect(put.status).toBe(200);
    expect(put.body.myReactions).toEqual(["yum"]);
    expect(put.body.reactions).toBeUndefined();
    await call(C, "PUT", `/snaps/${s.id}/reactions/fire`);
    expect((await call(C, "GET", `/snaps/${s.id}`)).body.myReactions).toEqual(["fire"]);
    const mine = (await call(A, "GET", `/snaps/${s.id}`)).body;
    expect(mine.reactions).toEqual(
      expect.arrayContaining([
        { userId: await id(B), name: "Bo", emoji: "yum" },
        { userId: await id(C), name: "Cy", emoji: "fire" },
      ]),
    );
    expect((await call(B, "PUT", `/snaps/${s.id}/reactions/yum`)).status).toBe(200);
    expect((await call(A, "GET", `/snaps/${s.id}`)).body.reactions).toHaveLength(2);
  });

  it("rejects an unknown key", async () => {
    const { A, send, call } = await mk();
    const s = (await send(A, { clientId: "s" })).body;
    expect((await call(A, "PUT", `/snaps/${s.id}/reactions/poop`)).status).toBe(400);
    expect((await call(A, "DELETE", `/snaps/${s.id}/reactions/poop`)).status).toBe(400);
  });

  it("gives 404 to a non-friend, a pending Friendship and a removed Friendship", async () => {
    const { o, A, B, C, send, call, link, befriend } = await mk();
    const s = (await send(A, { clientId: "s" })).body;
    for (const verb of ["PUT", "DELETE"]) expect((await call(B, verb, `/snaps/${s.id}/reactions/heart`)).status).toBe(404);
    await link(A, B, "pending");
    for (const verb of ["PUT", "DELETE"]) expect((await call(B, verb, `/snaps/${s.id}/reactions/heart`)).status).toBe(404);
    await befriend(A, C);
    expect((await call(C, "PUT", `/snaps/${s.id}/reactions/heart`)).status).toBe(200);
    await o.db.delete(friendships);
    for (const verb of ["PUT", "DELETE"]) expect((await call(C, verb, `/snaps/${s.id}/reactions/heart`)).status).toBe(404);
    expect((await call(A, "PUT", "/snaps/missing/reactions/heart")).status).toBe(404);
  });

  it("removes a Reaction, and DELETE of a missing one is 204 every time", async () => {
    const { A, B, send, call, befriend } = await mk();
    await befriend(A, B);
    const s = (await send(A, { clientId: "s" })).body;
    expect((await call(B, "DELETE", `/snaps/${s.id}/reactions/heart`)).status).toBe(204);
    await call(B, "PUT", `/snaps/${s.id}/reactions/heart`);
    expect((await call(B, "DELETE", `/snaps/${s.id}/reactions/heart`)).status).toBe(204);
    expect((await call(B, "DELETE", `/snaps/${s.id}/reactions/heart`)).status).toBe(204);
    expect((await call(B, "GET", `/snaps/${s.id}`)).body.myReactions).toEqual([]);
    expect((await call(A, "GET", `/snaps/${s.id}`)).body.reactions).toEqual([]);
    await call(B, "PUT", `/snaps/${s.id}/reactions/heart`);
    expect((await call(B, "GET", `/snaps/${s.id}`)).body.myReactions).toEqual(["heart"]);
  });

  it("queues one push per (Snap, user, key), even after DELETE then PUT, and none for the author", async () => {
    const { o, A, B, send, call, befriend, id } = await mk();
    await befriend(A, B);
    await sub(o, await id(A));
    await sub(o, await id(B));
    const s = (await send(A, { clientId: "s" })).body;
    await call(B, "PUT", `/snaps/${s.id}/reactions/heart`);
    await call(B, "PUT", `/snaps/${s.id}/reactions/heart`);
    await call(B, "DELETE", `/snaps/${s.id}/reactions/heart`);
    await call(B, "PUT", `/snaps/${s.id}/reactions/heart`);
    const rows = await o.db.select().from(pushDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.subscriptionId).toBe(`sub-${await id(A)}`);
    expect(rows[0]!.payload).toEqual({ type: "reaction", snapId: s.id, from: "Bo", emoji: "heart" });
    await call(B, "PUT", `/snaps/${s.id}/reactions/yum`);
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(2);
    await call(A, "PUT", `/snaps/${s.id}/reactions/heart`);
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(2);
  });
});

describe("delete a Snap", () => {
  it("is author-only (a Friend gets 404) and removes the row, Reactions and image files", async () => {
    const { o, A, B, send, call, befriend, id } = await mk();
    await befriend(A, B);
    const s = (await send(A, { clientId: "s" })).body;
    await o.db.insert(reactions).values({ snapId: s.id, userId: await id(B), emoji: "heart", createdAt: new Date() });
    expect((await call(B, "DELETE", `/snaps/${s.id}`)).status).toBe(404);
    const [row] = await o.db.select().from(snaps);
    expect(imageFiles().some((f) => f.startsWith(row!.imageId))).toBe(true);
    expect((await call(A, "DELETE", `/snaps/${s.id}`)).status).toBe(204);
    expect(await o.db.select().from(snaps)).toHaveLength(0);
    expect(await o.db.select().from(reactions)).toHaveLength(0);
    expect(await o.db.select().from(images)).toHaveLength(0);
    expect(imageFiles().some((f) => f.startsWith(row!.imageId))).toBe(false);
    expect((await call(A, "DELETE", `/snaps/${s.id}`)).status).toBe(404);
  });
});

describe("Linked recipe", () => {
  async function setup() {
    const t = await mk();
    const r = (await t.call(t.A, "POST", "/recipes", { name: "Soup", ingredients: [{ raw: "2 carrots" }], steps: [{ text: "Boil." }] })).body;
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: "#39c" } }).png().toBuffer())], "x.png", { type: "image/png" }));
    const up = await t.app.request(`/api/v1/recipes/${r.slug}/image`, { method: "POST", headers: { cookie: t.A, "x-requested-with": "meally" }, body: form });
    expect(up.status).toBe(201);
    const snap = (await t.send(t.A, { clientId: "s", recipeId: r.id })).body;
    return { ...t, r, snap };
  }

  it("lets an accepted Friend read it with image URLs on the Snap's paths, and shows savedSlug after saving", async () => {
    const { app, A, B, call, befriend, snap, r } = await setup();
    await befriend(A, B);
    const read = await call(B, "GET", `/snaps/${snap.id}/recipe`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ slug: r.slug, name: "Soup", savedSlug: null, ingredients: [{ raw: "2 carrots" }], steps: [{ text: "Boil." }] });
    expect(read.body.imageUrl).toMatch(new RegExp(`^/api/v1/snaps/${snap.id}/images/[^/]+/800$`));
    const img = await app.request(read.body.imageUrl, { headers: { cookie: B } });
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toContain("immutable");
    const saved = await call(B, "POST", `/snaps/${snap.id}/recipe/save`);
    expect(saved.status).toBe(201);
    expect((await call(B, "GET", `/snaps/${snap.id}/recipe`)).body.savedSlug).toBe(saved.body.slug);
    const mine = (await call(B, "GET", `/recipes/${saved.body.slug}`)).body;
    expect(mine).toMatchObject({ name: "Soup", savedFrom: { name: "Ann" } });
    expect(mine.imageUrl).toMatch(/^\/api\/v1\/images\//);
    expect((await app.request(mine.imageUrl, { headers: { cookie: B } })).status).toBe(200);
  });

  it("saves once: a second save returns 200 with the same copy and makes no new row", async () => {
    const { o, A, B, call, befriend, snap } = await setup();
    await befriend(A, B);
    const first = await call(B, "POST", `/snaps/${snap.id}/recipe/save`);
    const second = await call(B, "POST", `/snaps/${snap.id}/recipe/save`);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body.slug).toBe(first.body.slug);
    expect((await o.db.select().from(recipes)).filter((x) => x.name === "Soup")).toHaveLength(2);
  });

  it("gives the author 409 own_recipe on save and no savedSlug on read", async () => {
    const { A, call, snap } = await setup();
    const r = await call(A, "POST", `/snaps/${snap.id}/recipe/save`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("own_recipe");
    expect((await call(A, "GET", `/snaps/${snap.id}/recipe`)).body.savedSlug).toBeNull();
  });

  it("is a 404 for a Snap with no Linked recipe", async () => {
    const { A, send, call } = await setup();
    const plain = (await send(A, { clientId: "plain" })).body;
    expect((await call(A, "GET", `/snaps/${plain.id}/recipe`)).status).toBe(404);
    expect((await call(A, "POST", `/snaps/${plain.id}/recipe/save`)).status).toBe(404);
  });

  it("is a 404 on read, image and save for a non-friend and for a removed Friendship", async () => {
    const { app, A, B, C, call, befriend, id, snap } = await setup();
    const imageUrl = (await call(A, "GET", `/snaps/${snap.id}/recipe`)).body.imageUrl as string;
    const probe = async (cookie: string) => [
      (await call(cookie, "GET", `/snaps/${snap.id}/recipe`)).status,
      (await app.request(imageUrl, { headers: { cookie } })).status,
      (await call(cookie, "POST", `/snaps/${snap.id}/recipe/save`)).status,
    ];
    expect(await probe(C)).toEqual([404, 404, 404]);
    await befriend(A, B);
    expect(await probe(B)).toEqual([200, 200, 201]);
    await call(B, "DELETE", `/friends/${await id(A)}`);
    expect(await probe(B)).toEqual([404, 404, 404]);
  });

  it("is a 404 for a pending Friendship", async () => {
    const { A, B, call, link, snap } = await setup();
    await link(A, B, "pending");
    expect((await call(B, "GET", `/snaps/${snap.id}/recipe`)).status).toBe(404);
    expect((await call(B, "POST", `/snaps/${snap.id}/recipe/save`)).status).toBe(404);
  });

  it("only serves a recipe image id that is the Linked recipe's current one", async () => {
    const { app, A, snap } = await setup();
    const url = (await (await app.request(`/api/v1/snaps/${snap.id}/recipe`, { headers: { cookie: A } })).json() as any).imageUrl as string;
    const stale = url.replace(/\/images\/[^/]+\//, "/images/00000000-0000-0000-0000-000000000000/");
    expect((await app.request(stale, { headers: { cookie: A } })).status).toBe(404);
  });
});

describe("relink a Snap", () => {
  it("lets the author link, relink and unlink their own recipe", async () => {
    const { A, send, call, recipe } = await mk();
    const soup = await recipe(A, "Soup");
    const stew = await recipe(A, "Stew");
    const s = (await send(A, { clientId: "s", dishName: "Lunch" })).body;
    const linked = await call(A, "PATCH", `/snaps/${s.id}`, { recipeId: soup.id });
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ id: s.id, dishName: "Lunch", recipe: { slug: soup.slug, name: "Soup" } });
    expect((await call(A, "PATCH", `/snaps/${s.id}`, { recipeId: stew.id })).body.recipe.name).toBe("Stew");
    expect((await call(A, "PATCH", `/snaps/${s.id}`, { recipeId: null })).body.recipe).toBeNull();
    expect((await call(A, "GET", `/snaps/${s.id}/recipe`)).status).toBe(404);
  });

  it("is a 404 for another user's recipe and leaves the link unchanged", async () => {
    const { A, B, send, call, recipe } = await mk();
    const mine = await recipe(A, "Soup");
    const theirs = await recipe(B, "Stew");
    const s = (await send(A, { clientId: "s", recipeId: mine.id })).body;
    expect((await call(A, "PATCH", `/snaps/${s.id}`, { recipeId: theirs.id })).status).toBe(404);
    expect((await call(A, "PATCH", `/snaps/${s.id}`, { recipeId: "nope" })).status).toBe(404);
    expect((await call(A, "GET", `/snaps/${s.id}`)).body.recipe.name).toBe("Soup");
  });

  it("is a 404 for a Friend, a non-friend and a pending Friendship, and changes nothing", async () => {
    const { A, B, C, send, call, befriend, link, recipe } = await mk();
    const theirs = await recipe(B, "Stew");
    const s = (await send(A, { clientId: "s" })).body;
    expect((await call(B, "PATCH", `/snaps/${s.id}`, { recipeId: theirs.id })).status).toBe(404);
    await link(A, C, "pending");
    expect((await call(C, "PATCH", `/snaps/${s.id}`, { recipeId: null })).status).toBe(404);
    await befriend(A, B);
    expect((await call(B, "PATCH", `/snaps/${s.id}`, { recipeId: theirs.id })).status).toBe(404);
    expect((await call(B, "PATCH", `/snaps/${s.id}`, { recipeId: null })).status).toBe(404);
    expect((await call(A, "GET", `/snaps/${s.id}`)).body.recipe).toBeNull();
  });

  it("accepts only recipeId", async () => {
    const { A, send, call } = await mk();
    const s = (await send(A, { clientId: "s" })).body;
    expect((await call(A, "PATCH", `/snaps/${s.id}`, {})).status).toBe(400);
    expect((await call(A, "PATCH", `/snaps/${s.id}`, { recipeId: null, caption: "x" })).status).toBe(400);
  });
});

describe("processing limiter", () => {
  it("never runs more than the limit at once and runs every task", async () => {
    const run = createLimiter(2);
    let active = 0;
    let peak = 0;
    const out = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        run(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
          return i;
        }),
      ),
    );
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });
});
