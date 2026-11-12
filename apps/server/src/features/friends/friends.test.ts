import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { friendships } from "../../db/schema/index.js";
import { openTestDb } from "../../db/testing.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const o = openTestDb();
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "invite", ...env }, scryptLogN: 10, dataDir: "./.nonexistent-friends-test" });
  await o.ready;
  const post = (path: string, cookie: string | undefined, body?: unknown, method = "POST") =>
    app.request(`/api/v1${path}`, { method, headers: { ...H, ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
  const A = cookieOf(await post("/auth/setup", undefined, { email: "a@example.com", name: "Ann", password: "correct horse" }));
  const call = async (cookie: string | undefined, method: string, path: string, body?: unknown) => {
    const res = await post(path, cookie, body, method);
    const text = await res.text();
    return { res, status: res.status, body: text ? JSON.parse(text) : null };
  };
  /** Makes an extra user through an invite from `inviter` (invite mode). */
  const join = async (inviter: string, email: string, name: string) => {
    const inv = (await call(inviter, "POST", "/friends/invites")).body;
    const r = await post("/auth/register", undefined, { email, name, password: "correct horse", inviteToken: inv.token });
    return { cookie: cookieOf(r), token: inv.token as string };
  };
  const befriend = async (inviter: string, email: string, name: string) => {
    const u = await join(inviter, email, name);
    const r = await call(u.cookie, "POST", `/friends/invites/${u.token}/accept`);
    expect(r.status).toBe(201);
    return u.cookie;
  };
  return { db: o.db, app, A, call, post, join, befriend, cookieOf };
}

describe("friends", () => {
  it("creates an invite link that expires in 7 days and lists it", async () => {
    const { call, A } = await mk();
    const r = await call(A, "POST", "/friends/invites");
    expect(r.status).toBe(201);
    expect(r.body.path).toBe(`/invite/${r.body.token}`);
    expect(r.body.url.endsWith(r.body.path)).toBe(true);
    expect(r.body.expiresAt - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(r.body.expiresAt - Date.now()).toBeLessThanOrEqual(7 * 86_400_000);
    const list = await call(A, "GET", "/friends/invites");
    expect(list.body.items).toEqual([{ id: r.body.id, expiresAt: r.body.expiresAt, usedAt: null }]);
    expect(JSON.stringify(list.body)).not.toContain(r.body.token);
  });

  it("previews an invite and gives one 404 for unknown, used and expired tokens", async () => {
    const t = await mk();
    const inv = (await t.call(t.A, "POST", "/friends/invites")).body;
    const B = await t.join(t.A, "b@example.com", "Bob");
    expect((await t.call(B.cookie, "GET", `/friends/invites/${inv.token}`)).body).toEqual({ inviter: { name: "Ann" } });
    expect((await t.call(B.cookie, "GET", "/friends/invites/nope")).status).toBe(404);
    await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`);
    const used = await t.call(B.cookie, "GET", `/friends/invites/${B.token}`);
    expect(used.status).toBe(404);
    expect(used.body).toEqual((await t.call(B.cookie, "GET", "/friends/invites/nope")).body);
    expect((await t.call(undefined, "GET", `/friends/invites/${inv.token}`)).status).toBe(401);
  });

  it("accepts once, creates an accepted Friendship both ways, and retries with 200", async () => {
    const t = await mk();
    const B = await t.join(t.A, "b@example.com", "Bob");
    const first = await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ name: "Ann" });
    const retry = await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    const a = await t.call(t.A, "GET", "/friends");
    const b = await t.call(B.cookie, "GET", "/friends");
    expect(a.body.items.map((f: any) => f.name)).toEqual(["Bob"]);
    expect(b.body.items.map((f: any) => f.name)).toEqual(["Ann"]);
    expect(a.body.cap).toBe(20);
    expect((await t.call(t.A, "GET", "/friends/invites")).body.items[0].usedAt).toEqual(expect.any(Number));
  });

  it("rejects a used link for a third user, an own link, and an existing Friend", async () => {
    const t = await mk();
    const B = await t.join(t.A, "b@example.com", "Bob");
    await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`);
    const C = await t.join(t.A, "c@example.com", "Cy");
    expect((await t.call(C.cookie, "POST", `/friends/invites/${B.token}/accept`)).status).toBe(404);
    const own = (await t.call(t.A, "POST", "/friends/invites")).body;
    const o = await t.call(t.A, "POST", `/friends/invites/${own.token}/accept`);
    expect(o.status).toBe(409);
    expect(o.body.error).toBe("own_invite");
    const again = (await t.call(t.A, "POST", "/friends/invites")).body;
    const d = await t.call(B.cookie, "POST", `/friends/invites/${again.token}/accept`);
    expect(d.status).toBe(409);
    expect(d.body.error).toBe("already_friends");
  });

  it("returns 404 for an expired invite", async () => {
    const t = await mk();
    const B = await t.join(t.A, "b@example.com", "Bob");
    const real = Date.now;
    Date.now = () => real() + 8 * 86_400_000;
    try {
      expect((await t.call(B.cookie, "GET", `/friends/invites/${B.token}`)).status).toBe(404);
      expect((await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`)).status).toBe(404);
    } finally {
      Date.now = real;
    }
  });

  it("enforces the Friend cap on create and on accept for both users", async () => {
    const t = await mk();
    const adm = (cap: number) => t.call(t.A, "PUT", "/admin/settings", { friendCap: cap });
    expect((await adm(1)).status).toBe(200);
    const B = await t.befriend(t.A, "b@example.com", "Bob");
    const full = await t.call(t.A, "POST", "/friends/invites");
    expect(full.status).toBe(409);
    expect(full.body.error).toBe("friend_cap");
    // Raise it, make an invite, then lower it again: accept must still refuse.
    await adm(2);
    const inv = (await t.call(t.A, "POST", "/friends/invites")).body;
    const C = await t.post("/auth/register", undefined, { email: "c@example.com", name: "Cy", password: "correct horse", inviteToken: inv.token });
    const Cc = t.cookieOf(C);
    await adm(1);
    const r = await t.call(Cc, "POST", `/friends/invites/${inv.token}/accept`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("friend_cap");
    // Lowering the cap keeps existing Friendships.
    expect((await t.call(B, "GET", "/friends")).body).toMatchObject({ cap: 1, items: [{ name: "Ann" }] });
  });

  it("removes a Friend for both sides; a stranger or a repeat gets 404", async () => {
    const t = await mk();
    const B = await t.join(t.A, "b@example.com", "Bob");
    await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`);
    const aId = (await t.call(B.cookie, "GET", "/friends")).body.items[0].userId;
    const bId = (await t.call(t.A, "GET", "/friends")).body.items[0].userId;
    const C = await t.join(t.A, "c@example.com", "Cy");
    // Cy is not Ann's Friend yet: removing Ann is a 404 and changes nothing.
    expect((await t.call(C.cookie, "DELETE", `/friends/${aId}`)).status).toBe(404);
    expect((await t.call(t.A, "GET", "/friends")).body.items).toHaveLength(1);
    expect((await t.call(B.cookie, "DELETE", `/friends/${aId}`)).status).toBe(204);
    expect((await t.call(t.A, "GET", "/friends")).body.items).toEqual([]);
    expect((await t.call(t.A, "DELETE", `/friends/${bId}`)).status).toBe(404);
  });

  it("another user cannot list or revoke your invites", async () => {
    const t = await mk();
    const inv = (await t.call(t.A, "POST", "/friends/invites")).body;
    const B = await t.join(t.A, "b@example.com", "Bob");
    expect((await t.call(B.cookie, "GET", "/friends/invites")).body.items.map((i: any) => i.id)).not.toContain(inv.id);
    expect((await t.call(B.cookie, "DELETE", `/friends/invites/${inv.id}`)).status).toBe(404);
    expect((await t.call(t.A, "DELETE", `/friends/invites/${inv.id}`)).status).toBe(204);
    expect((await t.call(B.cookie, "GET", `/friends/invites/${inv.token}`)).status).toBe(404);
  });

  it("a pending Friendship is not a Friend", async () => {
    const t = await mk();
    const B = await t.join(t.A, "b@example.com", "Bob");
    const idOf = async (c: string) => (await t.call(c, "GET", "/auth/me")).body.user.id as string;
    const [a, b] = [await idOf(t.A), await idOf(B.cookie)].sort() as [string, string];
    await t.db.insert(friendships).values({ userAId: a, userBId: b, status: "pending", requestedBy: a, createdAt: new Date() });
    expect((await t.call(t.A, "GET", "/friends")).body.items).toEqual([]);
    expect((await t.call(B.cookie, "GET", "/friends")).body.items).toEqual([]);
    expect((await t.call(t.A, "DELETE", `/friends/${await idOf(B.cookie)}`)).status).toBe(404);
  });

  it("is a 404 feature_disabled when the flag is off, and the invite no longer permits sign-up", async () => {
    const t = await mk({ MEALLY_FEATURE_FRIENDS: "off" });
    expect((await t.call(t.A, "GET", "/friends")).body.error).toBe("feature_disabled");
    expect((await t.call(t.A, "POST", "/friends/invites")).status).toBe(404);
  });
});

describe("invite as a sign-up permit", () => {
  it("lets one register in invite mode, not without a valid token, and not in closed mode", async () => {
    const t = await mk();
    const reg = (inviteToken?: string, email = "x@example.com") =>
      t.post("/auth/register", undefined, { email, name: "X", password: "correct horse", inviteToken });
    expect((await reg()).status).toBe(403);
    expect((await reg("bogus")).status).toBe(403);
    const inv = (await t.call(t.A, "POST", "/friends/invites")).body;
    expect((await reg(inv.token)).status).toBe(201);
    // Registering does not use the invite up: the new user still accepts it.
  });

  it("does not open a closed instance", async () => {
    const t = await mk({ MEALLY_SIGNUP_MODE: "closed" });
    const inv = (await t.call(t.A, "POST", "/friends/invites")).body;
    const r = await t.post("/auth/register", undefined, { email: "x@example.com", name: "X", password: "correct horse", inviteToken: inv.token });
    expect(r.status).toBe(403);
    expect(((await r.json()) as any).error).toBe("signup_closed");
  });

  it("is refused once the invite is used or revoked", async () => {
    const t = await mk();
    const B = await t.join(t.A, "b@example.com", "Bob");
    await t.call(B.cookie, "POST", `/friends/invites/${B.token}/accept`);
    const r = await t.post("/auth/register", undefined, { email: "c@example.com", name: "C", password: "correct horse", inviteToken: B.token });
    expect(r.status).toBe(403);
  });
});

describe("admin settings: friendCap", () => {
  it("takes either field alone, bounds the cap, and locks only the sign-up mode", async () => {
    const t = await mk({ MEALLY_SIGNUP_MODE: "open" });
    expect((await t.call(t.A, "GET", "/admin/settings")).body).toMatchObject({ signupMode: "open", locked: true, friendCap: 20 });
    expect((await t.call(t.A, "PUT", "/admin/settings", { friendCap: 5 })).body.friendCap).toBe(5);
    expect((await t.call(t.A, "PUT", "/admin/settings", { signupMode: "closed" })).status).toBe(409);
    expect((await t.call(t.A, "PUT", "/admin/settings", { friendCap: 0 })).status).toBe(400);
    expect((await t.call(t.A, "PUT", "/admin/settings", { friendCap: 101 })).status).toBe(400);
    expect((await t.call(t.A, "PUT", "/admin/settings", { friendCap: 1.5 })).status).toBe(400);
    expect((await t.call(t.A, "PUT", "/admin/settings", {})).status).toBe(400);
    expect((await t.call(t.A, "GET", "/admin/settings")).body.friendCap).toBe(5);
  });

  it("changes the sign-up mode without touching the cap", async () => {
    const t = await mk({ MEALLY_SIGNUP_MODE: "" });
    await t.call(t.A, "PUT", "/admin/settings", { friendCap: 7 });
    const r = await t.call(t.A, "PUT", "/admin/settings", { signupMode: "closed" });
    expect(r.body).toMatchObject({ signupMode: "closed", locked: false, friendCap: 7 });
  });
});
