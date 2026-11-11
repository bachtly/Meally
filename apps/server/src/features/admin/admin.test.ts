import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}, withB = true) {
  const o = openTestDb();
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, dataDir: "./.nonexistent-admin-test" });
  await o.ready;
  const su = async (p: string, email: string, password = "correct horse") => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = withB ? await su("register", "b@example.com") : "";
  const req = (cookie: string, url: string, method = "GET", body?: unknown) =>
    app.request(`/api/v1/admin${url}`, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined });
  const json = async (r: Response) => (await r.json()) as any;
  const users = async () => (await json(await req(A, "/users"))).items as any[];
  return { app, A, B, req, json, users };
}

describe("admin", () => {
  it("rejects non-admins and anonymous callers", async () => {
    const t = await mk();
    for (const p of ["/features", "/settings", "/users", "/info"]) {
      expect((await t.req(t.B, p)).status).toBe(403);
      expect((await t.app.request(`/api/v1/admin${p}`)).status).toBe(401);
    }
  });

  it("sets, clears and env-locks feature flags", async () => {
    const t = await mk({ MEALLY_FEATURE_COOKBOOKS: "off" });
    const list = (await t.json(await t.req(t.A, "/features"))).features as any[];
    expect(list.find((f) => f.key === "cookbooks")).toMatchObject({ locked: true, enabled: false, envVar: "MEALLY_FEATURE_COOKBOOKS", dependsOn: [{ key: "organizers" }] });
    const r = await t.req(t.A, "/features/cookbooks", "PUT", { enabled: true });
    expect(r.status).toBe(409);
    expect((await t.json(r)).error).toBe("locked_by_env");
    const set = await t.json(await t.req(t.A, "/features/nutrition", "PUT", { enabled: true }));
    expect(set.features.find((f: any) => f.key === "nutrition")).toMatchObject({ enabled: true, source: "override" });
    const feat = await t.json(await t.app.request("/api/v1/features", { headers: { cookie: t.A } }));
    expect(feat.features.nutrition.enabled).toBe(true);
    const cleared = await t.json(await t.req(t.A, "/features/nutrition", "PUT", { enabled: null }));
    expect(cleared.features.find((f: any) => f.key === "nutrition")).toMatchObject({ enabled: false, source: "default" });
    expect((await t.req(t.A, "/features/nope", "PUT", { enabled: true })).status).toBe(404);
    expect((await t.req(t.A, "/features/nutrition", "PUT", { enabled: "x" })).status).toBe(400);
  });

  it("changes sign-up mode unless env locks it", async () => {
    const t = await mk({ MEALLY_SIGNUP_MODE: "" }, false);
    expect((await t.json(await t.req(t.A, "/settings"))).signupMode).toBe("invite");
    const r = await t.json(await t.req(t.A, "/settings", "PUT", { signupMode: "closed" }));
    expect(r).toMatchObject({ signupMode: "closed", locked: false });
    const l = await mk({ MEALLY_SIGNUP_MODE: "open" });
    expect((await l.json(await l.req(l.A, "/settings"))).locked).toBe(true);
    expect((await l.req(l.A, "/settings", "PUT", { signupMode: "closed" })).status).toBe(409);
  });

  it("lists and searches users", async () => {
    const t = await mk();
    const all = await t.json(await t.req(t.A, "/users"));
    expect(all.total).toBe(2);
    expect(all.items[0]).toMatchObject({ email: "a@example.com", role: "admin" });
    expect(all.items[0].householdName).toBeTruthy();
    expect(all.items[0].lastSeenAt).toBeTypeOf("number");
    const f = await t.json(await t.req(t.A, "/users?q=B@EX&limit=1"));
    expect(f.total).toBe(1);
    expect(f.items[0].email).toBe("b@example.com");
    expect((await t.json(await t.req(t.A, "/users?q=%25"))).total).toBe(0);
  });

  it("guards the last admin on demote and delete", async () => {
    const t = await mk();
    const [a, b] = await t.users();
    expect((await t.req(t.A, `/users/${a.id}`, "PATCH", { role: "member" })).status).toBe(409);
    expect((await t.req(t.A, `/users/${a.id}`, "DELETE")).status).toBe(409);
    expect((await t.req(t.A, `/users/${b.id}`, "PATCH", { role: "admin" })).status).toBe(200);
    expect((await t.req(t.A, `/users/${a.id}`, "PATCH", { role: "member" })).status).toBe(200);
    expect((await t.req(t.B, `/users/${b.id}`, "PATCH", { role: "member" })).status).toBe(409);
  });

  it("resets a password to a one-time temporary one and ends sessions", async () => {
    const t = await mk();
    const [, b] = await t.users();
    const r = await t.json(await t.req(t.A, `/users/${b.id}/reset-password`, "POST"));
    expect(r.temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect((await t.app.request("/api/v1/auth/me", { headers: { cookie: t.B } })).status).toBe(401);
    const login = await t.app.request("/api/v1/auth/login", { method: "POST", headers: H, body: JSON.stringify({ email: "b@example.com", password: r.temporaryPassword }) });
    expect(login.status).toBe(200);
    expect((await t.req(t.A, "/users/nope/reset-password", "POST")).status).toBe(404);
  });

  it("deletes a user with their sessions and their empty household", async () => {
    const t = await mk();
    const [, b] = await t.users();
    expect((await t.req(t.A, `/users/${b.id}`, "DELETE")).status).toBe(204);
    expect((await t.app.request("/api/v1/auth/me", { headers: { cookie: t.B } })).status).toBe(401);
    expect((await t.users()).length).toBe(1);
    expect((await t.json(await t.req(t.A, "/info"))).counts).toMatchObject({ users: 1, households: 1 });
  });

  it("keeps a household that still has recipes", async () => {
    const t = await mk();
    const [, b] = await t.users();
    const rec = await t.app.request("/api/v1/recipes", { method: "POST", headers: { ...H, cookie: t.B }, body: JSON.stringify({ name: "Soup", ingredients: [{ raw: "1 cup water" }], steps: [{ text: "Boil." }] }) });
    expect(rec.status).toBe(201);
    await t.req(t.A, `/users/${b.id}`, "DELETE");
    expect((await t.json(await t.req(t.A, "/info"))).counts).toMatchObject({ users: 1, households: 2, recipes: 1 });
  });

  it("reports server info", async () => {
    const t = await mk();
    const i = await t.json(await t.req(t.A, "/info"));
    expect(i).toMatchObject({ version: "0.0.0", counts: { users: 2, households: 2, recipes: 0 }, backupSchedule: { hours: 24, keep: 7 } });
    expect(i.migrations).toBeGreaterThanOrEqual(2);
    expect(i.nodeVersion).toMatch(/^v/);
  });
});
