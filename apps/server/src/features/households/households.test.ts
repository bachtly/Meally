import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { invites } from "../../db/schema/index.js";
import { openDb } from "../../db/index.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const { db, ready } = openDb(":memory:");
  await ready;
  const app = createApp({ db, env: { MEALLY_SIGNUP_MODE: "invite", ...env }, scryptLogN: 10 });
  const send = (path: string, method: string, data?: unknown, cookie?: string) =>
    app.request(`/api/v1${path}`, {
      method,
      headers: cookie ? { ...H, cookie } : H,
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  const ck = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
  const json = async (r: Response) => (await r.json()) as any;
  const owner = ck(await send("/auth/setup", "POST", { email: "a@example.com", name: "Ada", password: "correct horse" }));
  const invite = async (cookie = owner, body: unknown = {}) => json(await send("/household/invites", "POST", body, cookie));
  const register = (email: string, token?: string) =>
    send("/auth/register", "POST", { email, name: email.split("@")[0], password: "correct horse", inviteToken: token });
  return { app, db, send, ck, json, owner, invite, register };
}

describe("households", () => {
  it("owner creates an invite; a new user joins in invite mode, once", async () => {
    const t = await mk();
    const inv = await t.invite();
    expect(inv.url).toContain(`/sign-up?invite=${inv.token}`);
    const look = await t.json(await t.app.request(`/api/v1/auth/invite/${inv.token}`));
    expect(look).toEqual({ householdName: "Ada's household", valid: true });
    expect((await t.register("b@example.com")).status).toBe(403);
    const res = await t.register("b@example.com", inv.token);
    expect(res.status).toBe(201);
    const bCookie = t.ck(res);
    const h = await t.json(await t.send("/household", "GET", undefined, bCookie));
    expect(h.members.map((m: any) => [m.name, m.role])).toEqual([["Ada", "owner"], ["b", "member"]]);
    expect((await t.register("c@example.com", inv.token)).status).toBe(400);
    expect((await t.json(await t.app.request(`/api/v1/auth/invite/${inv.token}`))).valid).toBe(false);
    expect((await t.json(await t.send("/household/invites", "GET", undefined, t.owner))).items).toHaveLength(0);
  });

  it("works in open mode, but closed mode blocks", async () => {
    const open = await mk({ MEALLY_SIGNUP_MODE: "open" });
    const inv = await open.invite();
    const res = await open.register("b@example.com", inv.token);
    expect((await open.json(res)).household.name).toBe("Ada's household");
    const closed = await mk({ MEALLY_SIGNUP_MODE: "closed" });
    const inv2 = await closed.invite();
    expect((await closed.register("b@example.com", inv2.token)).status).toBe(403);
  });

  it("rejects expired, revoked and wrong-email invites", async () => {
    const t = await mk();
    const exp = await t.invite();
    await t.db.update(invites).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await t.register("b@example.com", exp.token)).status).toBe(400);
    expect((await t.json(await t.app.request(`/api/v1/auth/invite/${exp.token}`))).valid).toBe(false);
    const rev = await t.invite();
    expect((await t.send(`/household/invites/${rev.id}`, "DELETE", undefined, t.owner)).status).toBe(204);
    expect((await t.register("b@example.com", rev.token)).status).toBe(400);
    const named = await t.invite(t.owner, { email: "x@example.com" });
    expect((await t.register("b@example.com", named.token)).status).toBe(403);
    expect((await t.register("x@example.com", named.token)).status).toBe(201);
  });

  it("enforces owner-only actions", async () => {
    const t = await mk();
    const inv = await t.invite();
    const bRes = await t.register("b@example.com", inv.token);
    const b = t.ck(bRes);
    const bId = (await t.json(bRes)).user.id;
    expect((await t.send("/household", "PATCH", { name: "X" }, b)).status).toBe(403);
    expect((await t.send("/household/invites", "POST", {}, b)).status).toBe(403);
    expect((await t.send(`/household/members/${bId}`, "PATCH", { role: "owner" }, b)).status).toBe(403);
    expect((await t.send("/household", "PATCH", { name: "Home" }, t.owner)).status).toBe(200);
    expect((await t.json(await t.send("/household", "GET", undefined, b))).household.name).toBe("Home");
  });

  it("removal gives the member a fresh household and cuts access", async () => {
    const t = await mk();
    const bRes = await t.register("b@example.com", (await t.invite()).token);
    const b = t.ck(bRes);
    const bJson = await t.json(bRes);
    const oldHousehold = bJson.household.id;
    expect((await t.send("/recipes", "POST", { name: "Soup", ingredients: [], steps: [] }, t.owner)).status).toBeLessThan(300);
    expect((await t.json(await t.send("/recipes", "GET", undefined, b))).items.length).toBe(1);
    expect((await t.send(`/household/members/${bJson.user.id}`, "DELETE", undefined, t.owner)).status).toBe(204);
    const me = await t.json(await t.send("/auth/me", "GET", undefined, b));
    expect(me.user.householdId).not.toBe(oldHousehold);
    expect(me.user.householdRole).toBe("owner");
    expect((await t.json(await t.send("/recipes", "GET", undefined, b))).items).toHaveLength(0);
    const h = await t.json(await t.send("/household", "GET", undefined, b));
    expect(h.members).toHaveLength(1);
    expect((await t.send(`/household/members/${bJson.user.id}`, "DELETE", undefined, t.owner)).status).toBe(404);
  });

  it("leave semantics, including the last-owner rule", async () => {
    const t = await mk();
    const bRes = await t.register("b@example.com", (await t.invite()).token);
    const b = t.ck(bRes);
    const bId = (await t.json(bRes)).user.id;
    const aId = (await t.json(await t.send("/auth/me", "GET", undefined, t.owner))).user.id;
    expect((await t.send("/household/leave", "POST", {}, t.owner)).status).toBe(409);
    expect((await t.send(`/household/members/${aId}`, "PATCH", { role: "member" }, t.owner)).status).toBe(409);
    expect((await t.send(`/household/members/${bId}`, "PATCH", { role: "owner" }, t.owner)).status).toBe(200);
    expect((await t.send(`/household/members/${aId}`, "PATCH", { role: "member" }, b)).status).toBe(200);
    expect((await t.send("/household/leave", "POST", {}, t.owner)).status).toBe(204);
    expect((await t.json(await t.send("/household", "GET", undefined, t.owner))).members).toHaveLength(1);
    expect((await t.send("/household/leave", "POST", {}, t.owner)).status).toBe(409);
  });

  it("a signed-in user joins another household with a token", async () => {
    const t = await mk({ MEALLY_SIGNUP_MODE: "open" });
    const b = t.ck(await t.register("b@example.com"));
    const inv = await t.invite();
    expect((await t.send("/household/join", "POST", { token: "nope" }, b)).status).toBe(400);
    expect((await t.send("/household/join", "POST", { token: inv.token }, b)).status).toBe(204);
    expect((await t.json(await t.send("/household", "GET", undefined, b))).members).toHaveLength(2);
    expect((await t.send("/household/join", "POST", { token: inv.token }, t.owner)).status).toBe(409);
  });

  it("is hidden when the flag is off", async () => {
    const t = await mk({ MEALLY_FEATURE_HOUSEHOLDS: "off" });
    expect((await t.send("/household", "GET", undefined, t.owner)).status).toBe(404);
  });
});
