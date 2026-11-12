import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { friendships, images, reactions, snaps } from "../../db/schema/index.js";
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
