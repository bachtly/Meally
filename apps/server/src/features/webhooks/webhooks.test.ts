import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../../app.js";
import { openTestDb } from "../../db/testing.js";
import { createNodePlatform } from "../../adapters/node/index.js";
import { webhookDeliveries, webhookRetries, webhooks } from "../../db/schema/index.js";
import { createFlagsService } from "../features/service.js";
import { createFetcher, type Fetcher } from "../import-url/fetch.js";
import { verifyWebhook } from "./verify-helper.js";
import { createDispatcher, digestDue, KEEP_DELIVERIES, MAX_FAILURES, MAX_RETRIES, RETRY_CAP_MS, RETRY_BASE_MS, assertWebhookUrl, legacySign, retryDelayMs, sign } from "./service.js";

const H = { "content-type": "application/json", "x-requested-with": "meally" };
const GOOD = { name: "Hook", url: "https://example.com/hook", events: ["recipe.created", "mealplan.today"], tz: "Asia/Tokyo", dailyAt: "07:00" };
const RECIPE = { name: "Soup", ingredients: [{ raw: "1 cup milk" }], steps: [{ text: "Stir" }] };

afterEach(() => vi.useRealTimers());

async function mk(status: number | "throw" = 200) {
  const o = openTestDb();
  const env = { MEALLY_SIGNUP_MODE: "open" };
  const flags = createFlagsService(o.db, env);
  const sent: Array<{ url: string; body: string; headers: Record<string, string> }> = [];
  const state = { status };
  const fetcher: Fetcher = async (url, opts) => {
    sent.push({ url, body: String(opts.body), headers: opts.headers! });
    if (state.status === "throw") throw new Error("boom");
    return { body: Buffer.alloc(0), contentType: "", finalUrl: url, status: state.status as number };
  };
  const platform = createNodePlatform({ dataDir: "./.vdata-test-unused", scryptLogN: 10 });
  const app = createApp({ db: o.db, flags, env, platform, fetcher });
  await o.ready;
  await flags.setOverride("api-tokens", true);
  await flags.setOverride("webhooks", true);
  const su = async (p: string, email: string, extra: object = {}) => {
    const r = await app.request(`/api/v1/auth/${p}`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ email, name: "n", password: "correct horse", ...extra }),
    });
    return r.headers.get("set-cookie")!.split(";")[0]!;
  };
  const A = await su("setup", "a@example.com");
  const B = await su("register", "b@example.com");
  const call = (c: string, method: string, url: string, body?: unknown) =>
    app.request(`/api/v1${url}`, { method, headers: { ...H, cookie: c }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (r: Response) => (await r.json()) as any;
  const create = async (body: object = GOOD) => json(await call(A, "POST", "/webhooks", body));
  return { app, o, flags, platform, A, B, call, json, create, sent, state, su, fetcher };
}

describe("signing", () => {
  const body = '{"event":"ping"}';
  it("matches an independent HMAC-SHA256 of '<t>.<body>'", () => {
    expect(sign("s3cret", body, 1700000000)).toBe(`t=1700000000,v1=${createHmac("sha256", "s3cret").update(`1700000000.${body}`).digest("hex")}`);
  });
  it("matches a fixed vector", () => {
    expect(sign("secret", "hello", 1000)).toBe("t=1000,v1=68b4e0f3cbf572d8f2a61a0a26389c0880345705e6cbca10add63a2651feefb0");
    expect(legacySign("secret", "hello")).toBe("sha256=88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b");
  });
  it("verifies, and enforces the 5 minute tolerance and tampering", () => {
    const h = sign("s", body, 1000);
    expect(verifyWebhook(body, h, "s", 1000)).toBe(true);
    expect(verifyWebhook(body, h, "s", 1300)).toBe(true);
    expect(verifyWebhook(body, h, "s", 1301)).toBe(false);
    expect(verifyWebhook(body, h, "s", 699)).toBe(false);
    expect(verifyWebhook(body + " ", h, "s", 1000)).toBe(false);
    expect(verifyWebhook(body, h, "other", 1000)).toBe(false);
    expect(verifyWebhook(body, "t=1000,v1=zz", "s", 1000)).toBe(false);
    expect(verifyWebhook(body, undefined, "s", 1000)).toBe(false);
  });
});

describe("webhook routes", () => {
  it("creates with a secret, re-views it as owner, hides it from the list", async () => {
    const t = await mk();
    const w = await t.create();
    expect(w.secret).toMatch(/^whsec_/);
    expect(w.tz).toBe("Asia/Tokyo");
    expect((await t.json(await t.call(t.A, "GET", `/webhooks/${w.id}`))).secret).toBe(w.secret);
    expect(JSON.stringify(await t.json(await t.call(t.A, "GET", "/webhooks")))).not.toContain(w.secret);
    const upd = await t.json(await t.call(t.A, "PUT", `/webhooks/${w.id}`, { ...GOOD, name: "Renamed" }));
    expect(upd.name).toBe("Renamed");
    expect((await t.call(t.A, "DELETE", `/webhooks/${w.id}`)).status).toBe(204);
  });

  it("validates input", async () => {
    const t = await mk();
    for (const bad of [{ ...GOOD, url: "nope" }, { ...GOOD, events: [] }, { ...GOOD, tz: "Mars/Base" }, { ...GOOD, dailyAt: "7am" }])
      expect((await t.call(t.A, "POST", "/webhooks", bad)).status).toBe(400);
  });

  it("is isolated per user", async () => {
    const t = await mk();
    const w = await t.create();
    const cases: Array<[string, string]> = [["GET", ""], ["PUT", ""], ["DELETE", ""], ["POST", "/test"], ["GET", "/deliveries"]];
    for (const [m, u] of cases) expect((await t.call(t.B, m, `/webhooks/${w.id}${u}`, m === "PUT" ? GOOD : undefined)).status).toBe(404);
    expect((await t.json(await t.call(t.B, "GET", "/webhooks"))).items).toEqual([]);
  });

  it("lets any signed-in user manage their own webhooks", async () => {
    const t = await mk();
    expect((await t.call(t.B, "GET", "/webhooks")).status).toBe(200);
    expect((await t.call(t.B, "POST", "/webhooks", GOOD)).status).toBe(201);
    expect((await t.json(await t.call(t.A, "GET", "/webhooks"))).items).toEqual([]);
  });

  it("is hidden when the flag is off", async () => {
    const t = await mk();
    await t.flags.setOverride("webhooks", false);
    expect((await t.call(t.A, "GET", "/webhooks")).status).toBe(404);
  });

  it("sends a signed ping on test and logs it", async () => {
    const t = await mk();
    const w = await t.create();
    const r = await t.json(await t.call(t.A, "POST", `/webhooks/${w.id}/test`));
    expect(r.ok).toBe(true);
    const s = t.sent[0]!;
    expect(s.headers["X-Meally-Event"]).toBe("ping");
    expect(s.headers["X-Meally-Delivery"]).toBeTruthy();
    const ts = Number(s.headers["X-Meally-Timestamp"]);
    expect(Math.abs(Date.now() / 1000 - ts)).toBeLessThan(5);
    expect(s.headers["X-Meally-Signature"]).toBe(sign(w.secret, s.body, ts));
    expect(verifyWebhook(s.body, s.headers["X-Meally-Signature"], w.secret, ts)).toBe(true);
    expect(s.headers["X-Meally-Signature-256"]).toBe(legacySign(w.secret, s.body));
    expect(JSON.parse(s.body)).toMatchObject({ event: "ping", user: { name: expect.any(String) } });
    expect((await t.json(await t.call(t.A, "GET", `/webhooks/${w.id}/deliveries`))).items).toHaveLength(1);
    expect((await t.json(await t.call(t.A, "GET", `/webhooks/${w.id}`))).lastStatus).toBe(200);
  });
});

describe("delivery", () => {
  it("emits recipe.created from the recipe service to subscribed hooks only", async () => {
    const t = await mk();
    await t.create();
    await t.create({ ...GOOD, name: "Other", events: ["recipe.deleted"] });
    expect((await t.call(t.A, "POST", "/recipes", RECIPE)).status).toBe(201);
    await vi.waitFor(() => expect(t.sent).toHaveLength(1));
    expect(JSON.parse(t.sent[0]!.body)).toMatchObject({ event: "recipe.created", data: { slug: "soup", name: "Soup" } });
  });

  it("emits nothing when the flag is off", async () => {
    const t = await mk();
    await t.create();
    await t.flags.setOverride("webhooks", false);
    await t.call(t.A, "POST", "/recipes", RECIPE);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.sent).toHaveLength(0);
  });

  const dueNow = (t: Awaited<ReturnType<typeof mk>>) => t.o.db.update(webhookRetries).set({ nextAt: new Date(Date.now() - 1000) });
  const waitSent = async (t: Awaited<ReturnType<typeof mk>>, n: number) => {
    for (const end = Date.now() + 10_000; Date.now() < end && t.sent.length < n; ) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 100)); // let the attempt be recorded
  };

  it("stores retries durably and sends them from the retry job, 3 times at most", async () => {
    const t = await mk(500);
    await t.create();
    await t.call(t.A, "POST", "/recipes", RECIPE);
    await waitSent(t, 1);
    expect(t.sent).toHaveLength(1);
    for (let i = 0; i < MAX_RETRIES; i++) {
      const rows = await t.o.db.select().from(webhookRetries);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.attempt).toBe(i);
      expect(rows[0]!.nextAt.getTime()).toBeGreaterThan(Date.now() - 1000); // not due yet
      await t.platform.scheduler.runJob("webhooks.retry");
      expect(t.sent).toHaveLength(i + 1); // nothing due, nothing sent
      await dueNow(t);
      await t.platform.scheduler.runJob("webhooks.retry");
      expect(t.sent).toHaveLength(i + 2);
    }
    expect(await t.o.db.select().from(webhookRetries)).toHaveLength(0);
    expect(new Set(t.sent.map((s) => s.headers["X-Meally-Delivery"])).size).toBe(4);
  });

  it("is re-entrant: two overlapping retry runs send each retry once", async () => {
    const t = await mk(500);
    await t.create();
    await t.call(t.A, "POST", "/recipes", RECIPE);
    await waitSent(t, 1);
    await dueNow(t);
    await Promise.all([t.platform.scheduler.runJob("webhooks.retry"), t.platform.scheduler.runJob("webhooks.retry")]);
    expect(t.sent).toHaveLength(2);
  });

  it("is re-entrant: two overlapping digest runs send the digest once", async () => {
    const t = await mk(200);
    const w = await t.create();
    await t.o.db.update(webhooks).set({ dailyAt: new Date(Date.now() - 60_000).toISOString().slice(11, 16), tz: "UTC" }).where(eq(webhooks.id, w.id));
    await Promise.all([t.platform.scheduler.runJob("mealplan.digest"), t.platform.scheduler.runJob("mealplan.digest")]);
    expect(t.sent.filter((s) => s.headers["X-Meally-Event"] === "mealplan.today")).toHaveLength(1);
  });

  it("auto-disables after 20 consecutive failures and resets on success", async () => {
    const t = await mk(500);
    const w = await t.create();
    for (let i = 0; i < MAX_FAILURES - 1; i++) await t.call(t.A, "POST", `/webhooks/${w.id}/test`);
    t.state.status = 200;
    await t.call(t.A, "POST", `/webhooks/${w.id}/test`);
    expect((await t.json(await t.call(t.A, "GET", `/webhooks/${w.id}`))).failureCount).toBe(0);
    t.state.status = "throw";
    for (let i = 0; i < MAX_FAILURES; i++) await t.call(t.A, "POST", `/webhooks/${w.id}/test`);
    const after = await t.json(await t.call(t.A, "GET", `/webhooks/${w.id}`));
    expect(after.enabled).toBe(false);
    expect(after.failureCount).toBe(MAX_FAILURES);
    const re = await t.json(await t.call(t.A, "PUT", `/webhooks/${w.id}`, { ...GOOD, enabled: true }));
    expect(re.enabled).toBe(true);
    expect(re.failureCount).toBe(0);
  });

  it("keeps only the last 50 deliveries", async () => {
    const t = await mk();
    const w = await t.create();
    for (let i = 0; i < KEEP_DELIVERIES + 5; i++) await t.call(t.A, "POST", `/webhooks/${w.id}/test`);
    const rows = await t.o.db.select().from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, w.id));
    expect(rows).toHaveLength(KEEP_DELIVERIES);
  });

  it("refuses private addresses through the real fetcher", async () => {
    const f = createFetcher({ resolve: async () => ["10.0.0.5"], transport: vi.fn() });
    await expect(f("http://internal.example/hook", { kind: "post", body: "{}" })).rejects.toMatchObject({ code: "blocked_url" });
    await expect(createFetcher({ transport: vi.fn() })("http://127.0.0.1/x", { kind: "post", body: "{}" })).rejects.toMatchObject({ code: "blocked_url" });
  });

  it("posts the body and reports redirects without following them", async () => {
    const transport = vi.fn(async (_req: unknown) => ({ status: 302, headers: { location: "http://10.0.0.1/" }, body: (async function* () {})(), destroy() {} }));
    const f = createFetcher({ resolve: async () => ["93.184.216.34"], transport });
    const r = await f("https://example.com/h", { kind: "post", body: '{"a":1}', headers: { "X-Meally-Event": "ping" } });
    expect(r.status).toBe(302);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toMatchObject({ method: "POST", body: '{"a":1}', headers: { "X-Meally-Event": "ping" } });
  });
});

describe("retry jitter", () => {
  it("stays within [0, min(cap, base*2^n)) and grows then caps, with a seeded random", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    for (let n = 0; n < 10; n++) {
      const ceil = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** n);
      for (let i = 0; i < 200; i++) {
        const d = retryDelayMs(n, rnd);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThan(ceil);
      }
    }
    expect(retryDelayMs(0, () => 0.999999)).toBeLessThan(RETRY_BASE_MS);
    expect(retryDelayMs(20, () => 0.999999)).toBeLessThan(RETRY_CAP_MS);
    expect(retryDelayMs(3, () => 0)).toBe(0);
    expect(new Set(Array.from({ length: 20 }, () => retryDelayMs(2, rnd))).size).toBeGreaterThan(1);
  });
});

describe("https only", () => {
  const HTTP = { ...GOOD, url: "http://hook.lan/x" };
  it("rejects http on create and update by default", async () => {
    const t = await mk();
    const r = await t.call(t.A, "POST", "/webhooks", HTTP);
    expect(r.status).toBe(400);
    expect((await t.json(r)).message).toContain("https://");
    const w = await t.create();
    expect((await t.call(t.A, "PUT", `/webhooks/${w.id}`, HTTP)).status).toBe(400);
  });
  it("assertWebhookUrl allows http only with private URLs allowed", () => {
    expect(() => assertWebhookUrl("http://a.lan/x", false)).toThrow(/https/);
    expect(() => assertWebhookUrl("ftp://a.lan/x", true)).toThrow(/https/);
    expect(() => assertWebhookUrl("http://a.lan/x", true)).not.toThrow();
    expect(() => assertWebhookUrl("https://a.example/x", false)).not.toThrow();
  });
  it("allows http with MEALLY_ALLOW_PRIVATE_URLS and still delivers", async () => {
    const o = openTestDb();
    const env = { MEALLY_SIGNUP_MODE: "open", MEALLY_ALLOW_PRIVATE_URLS: "true" };
    const flags = createFlagsService(o.db, env);
    const sent: string[] = [];
    const fetcher: Fetcher = async (url) => (sent.push(url), { body: Buffer.alloc(0), contentType: "", finalUrl: url, status: 200 });
    const platform = createNodePlatform({ dataDir: "./.vdata-test-unused", scryptLogN: 10 });
  const app = createApp({ db: o.db, flags, env, platform, fetcher });
    await o.ready;
    await flags.setOverride("api-tokens", true);
    await flags.setOverride("webhooks", true);
    const su = await app.request("/api/v1/auth/setup", { method: "POST", headers: H, body: JSON.stringify({ email: "a@example.com", name: "n", password: "correct horse" }) });
    const cookie = su.headers.get("set-cookie")!.split(";")[0]!;
    const r = await app.request("/api/v1/webhooks", { method: "POST", headers: { ...H, cookie }, body: JSON.stringify(HTTP) });
    expect(r.status).toBe(201);
    const w = (await r.json()) as any;
    const test = await app.request(`/api/v1/webhooks/${w.id}/test`, { method: "POST", headers: { ...H, cookie } });
    expect(((await test.json()) as any).ok).toBe(true);
    expect(sent).toEqual(["http://hook.lan/x"]);
  });
  it("refuses to deliver to a stored http URL when not allowed", async () => {
    const t = await mk();
    const w = await t.create();
    await t.o.db.update(webhooks).set({ url: "http://hook.lan/x" }).where(eq(webhooks.id, w.id));
    const r = await t.json(await t.call(t.A, "POST", `/webhooks/${w.id}/test`));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("https://");
    expect(t.sent).toHaveLength(0);
  });
});

describe("daily digest", () => {
  it("is due once per local day, from dailyAt, in the hook timezone", () => {
    const h = { dailyAt: "07:00", tz: "Asia/Tokyo", lastDigestOn: null as string | null };
    expect(digestDue(new Date("2026-01-09T21:59:00Z"), h).due).toBe(false); // 06:59 JST
    expect(digestDue(new Date("2026-01-09T22:00:00Z"), h)).toEqual({ due: true, date: "2026-01-10" });
    expect(digestDue(new Date("2026-01-09T22:30:00Z"), { ...h, lastDigestOn: "2026-01-10" }).due).toBe(false);
    expect(digestDue(new Date("2026-01-10T01:30:00Z"), h).due).toBe(false); // over 2 h late
    expect(digestDue(new Date("2026-01-10T22:00:00Z"), { ...h, lastDigestOn: "2026-01-10" }).due).toBe(true);
  });

  it("sends the digest on tick and not twice", async () => {
    const t = await mk();
    await t.create();
    const d = createDispatcher({ db: t.o.db, fetcher: t.fetcher, flags: t.flags });
    await d.tick(new Date("2026-01-09T22:05:00Z"));
    await d.tick(new Date("2026-01-09T22:06:00Z"));
    expect(t.sent).toHaveLength(1);
    expect(JSON.parse(t.sent[0]!.body)).toMatchObject({ event: "mealplan.today", data: { date: "2026-01-10", entries: [] } });
  });
});
