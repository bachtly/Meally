import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";
import { apiTokens } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";
import { createFlagsService } from "../features/service.js";
import { hashToken } from "./service.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}, tokenLimit?: number) {
  const o = openTestDb();
  const flags = createFlagsService(o.db, { MEALLY_SIGNUP_MODE: "open", ...env });
  const app = createApp({ db: o.db, flags, env: { MEALLY_SIGNUP_MODE: "open", ...env }, scryptLogN: 10, tokenLimit });
  await o.ready;
  const su = async (p: string, email: string) => {
    const r = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name: "n", password: "correct horse" }) });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = await su("register", "b@example.com");
  const json = async (r: Response) => (await r.json()) as any;
  const cookie = (c: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) });
  const bearer = (t: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, {
      method,
      headers: { authorization: `Bearer ${t}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const mint = async (c: string, scope: "read" | "write", extra: object = {}) =>
    (await json(await cookie(c, "POST", "/tokens", { name: "script", scope, ...extra }))) as { token: string; item: any };
  return { app, o, flags, A, B, json, cookie, bearer, mint };
}

describe("api tokens", () => {
  it("creates a prefixed token, stores only the hash, and lists without secrets", async () => {
    const { o, A, cookie, json, mint } = await mk();
    const { token, item } = await mint(A, "write");
    expect(token).toMatch(/^mly_[A-Za-z0-9_-]{43}$/);
    expect(item.prefix).toBe(token.slice(0, 8));
    const rows = await o.db.select().from(apiTokens);
    expect(rows[0]!.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(rows[0])).not.toContain(token);
    const list = await json(await cookie(A, "GET", "/tokens"));
    expect(Object.keys(list.items[0]).sort()).toEqual(["createdAt", "expiresAt", "id", "lastUsedAt", "name", "prefix", "scope"]);
    expect(JSON.stringify(list)).not.toContain(token);
  });

  it("authenticates with a bearer token, and a write token can write without CSRF headers", async () => {
    const { A, bearer, mint, json } = await mk();
    const { token } = await mint(A, "write");
    expect((await bearer(token, "GET", "/recipes")).status).toBe(200);
    const res = await bearer(token, "POST", "/recipes", { name: "Soup", ingredients: [{ raw: "1 cup milk" }], steps: [{ text: "Stir" }] });
    expect(res.status).toBe(201);
    expect((await json(res)).slug).toBe("soup");
  });

  it("blocks writes for a read-scope token", async () => {
    const { A, bearer, mint, json } = await mk();
    const { token } = await mint(A, "read");
    expect((await bearer(token, "GET", "/recipes")).status).toBe(200);
    const res = await bearer(token, "POST", "/recipes", { name: "x", ingredients: [], steps: [] });
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe("insufficient_scope");
  });

  it("rejects revoked, expired and unknown tokens", async () => {
    const { o, A, bearer, mint, cookie } = await mk();
    const a = await mint(A, "read");
    expect((await cookie(A, "DELETE", `/tokens/${a.item.id}`)).status).toBe(204);
    expect((await bearer(a.token, "GET", "/recipes")).status).toBe(401);
    const b = await mint(A, "read", { expiresInDays: 1 });
    expect((await bearer(b.token, "GET", "/recipes")).status).toBe(200);
    await o.db.update(apiTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(apiTokens.id, b.item.id));
    expect((await bearer(b.token, "GET", "/recipes")).status).toBe(401);
    expect((await bearer("mly_nope", "GET", "/recipes")).status).toBe(401);
  });

  it("rejects bearer tokens when the flag is off", async () => {
    const t = await mk();
    const { token } = await t.mint(t.A, "write");
    expect((await t.bearer(token, "GET", "/recipes")).status).toBe(200);
    await t.flags.setOverride("api-tokens", false);
    expect((await t.bearer(token, "GET", "/recipes")).status).toBe(401);
    expect((await t.cookie(t.A, "GET", "/tokens")).status).toBe(404);
  });

  it("rejects a request that has both a cookie and a bearer token", async () => {
    const { app, A, mint, json } = await mk();
    const { token } = await mint(A, "write");
    const res = await app.request("/api/v1/recipes", { headers: { cookie: A, authorization: `Bearer ${token}` } });
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("mixed_auth");
  });

  it("keeps tokens private to their owner and stops tokens managing tokens", async () => {
    const { A, B, cookie, json, mint, bearer } = await mk();
    const a = await mint(A, "write");
    expect((await json(await cookie(B, "GET", "/tokens"))).items).toEqual([]);
    expect((await cookie(B, "DELETE", `/tokens/${a.item.id}`)).status).toBe(404);
    expect((await bearer(a.token, "GET", "/tokens")).status).toBe(403);
    expect((await bearer(a.token, "POST", "/tokens", { name: "x", scope: "read" })).status).toBe(403);
    expect((await json(await cookie(A, "GET", "/tokens"))).items).toHaveLength(1);
  });

  it("scopes a token to its owner", async () => {
    const { A, B, cookie, bearer, mint } = await mk();
    await cookie(A, "POST", "/recipes", { name: "Secret", ingredients: [{ raw: "1 egg" }], steps: [{ text: "Boil" }] });
    const b = await mint(B, "read");
    expect((await bearer(b.token, "GET", "/recipes/secret")).status).toBe(404);
  });

  it("updates last_used_at at most once a minute", async () => {
    const { o, A, bearer, mint } = await mk();
    const { token, item } = await mint(A, "read");
    await bearer(token, "GET", "/recipes");
    const first = (await o.db.select().from(apiTokens).where(eq(apiTokens.id, item.id)))[0]!.lastUsedAt!;
    expect(first).toBeTruthy();
    await bearer(token, "GET", "/recipes");
    expect((await o.db.select().from(apiTokens).where(eq(apiTokens.id, item.id)))[0]!.lastUsedAt).toEqual(first);
  });

  it("rate-limits per token", async () => {
    const { A, bearer, mint, json } = await mk({}, 3);
    const t1 = await mint(A, "read");
    const t2 = await mint(A, "read");
    for (let i = 0; i < 3; i++) expect((await bearer(t1.token, "GET", "/recipes")).status).toBe(200);
    const res = await bearer(t1.token, "GET", "/recipes");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect((await json(res)).error).toBe("rate_limited");
    expect((await bearer(t2.token, "GET", "/recipes")).status).toBe(200);
  });

  it("validates the create body", async () => {
    const { A, cookie } = await mk();
    expect((await cookie(A, "POST", "/tokens", { name: "", scope: "read" })).status).toBe(400);
    expect((await cookie(A, "POST", "/tokens", { name: "x", scope: "admin" })).status).toBe(400);
  });
});
