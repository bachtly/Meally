import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createApp } from "../../app.js";
import { createNodePlatform } from "../../adapters/node/index.js";
import { friendships, instanceSettings, pushDeliveries, pushSubscriptions } from "../../db/schema/index.js";
import { openTestDb } from "../../db/testing.js";
import { ApiError } from "../../lib/errors.js";
import { createFlagsService } from "../features/service.js";
import type { Fetcher } from "../import-url/fetch.js";
import { PUSH_JOB, VAPID_KEY, MAX_SUBSCRIPTIONS_PER_USER } from "./service.js";
import { b64 } from "./webpush.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-push-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

type Sent = { url: string; body: Uint8Array; headers: Record<string, string> };

async function browserKeys() {
  const pair = await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", pair.publicKey));
  return { p256dh: b64.encode(pub), auth: b64.encode(globalThis.crypto.getRandomValues(new Uint8Array(16))) };
}

async function mk(env: Record<string, string> = {}) {
  const o = openTestDb();
  const sent: Sent[] = [];
  const answer: { status: number | "throw" | "blocked" } = { status: 201 };
  const fetcher: Fetcher = async (url, opts) => {
    sent.push({ url, body: opts.body as Uint8Array, headers: opts.headers! });
    if (answer.status === "throw") throw new Error("boom");
    if (answer.status === "blocked") throw new ApiError(400, "blocked_url", "That address is not allowed");
    return { body: Buffer.alloc(0), contentType: "", finalUrl: url, status: answer.status as number };
  };
  const flags = createFlagsService(o.db, { MEALLY_SIGNUP_MODE: "open", ...env });
  const base = createNodePlatform({ dataDir, scryptLogN: 10 });
  // runAfter is a no-op so tests decide when the job runs.
  const platform = { ...base, scheduler: { ...base.scheduler, runAfter: () => {} } };
  const app = createApp({ db: o.db, env: { MEALLY_SIGNUP_MODE: "open", ...env }, platform, dataDir, fetcher, flags });
  await o.ready;
  const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;
  const reg = async (p: "setup" | "register", email: string, name: string) =>
    cookieOf(await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name, password: "correct horse" }) }));
  const json = async (res: Response) => {
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
  const call = async (cookie: string, method: string, p: string, body?: unknown) =>
    json(await app.request(`/api/v1${p}`, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined }));
  const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#c33" } }).png().toBuffer();
  let n = 0;
  const snap = async (cookie: string, clientId = `c${++n}`) => {
    const form = new FormData();
    form.set("clientId", clientId);
    form.set("file", new File([new Uint8Array(png)], "x.png", { type: "image/png" }));
    return json(await app.request("/api/v1/snaps", { method: "POST", headers: { cookie, "x-requested-with": "meally" }, body: form }));
  };
  const A = await reg("setup", "a@example.com", "Ann");
  const B = await reg("register", "b@example.com", "Bo");
  const C = await reg("register", "c@example.com", "Cy");
  const id = async (cookie: string) => (await call(cookie, "GET", "/auth/me")).body.user.id as string;
  const befriend = async (x: string, y: string, status: "accepted" | "pending" = "accepted") => {
    const [a, b] = [await id(x), await id(y)].sort() as [string, string];
    const now = new Date();
    await o.db.insert(friendships).values({ userAId: a, userBId: b, status, requestedBy: a, createdAt: now, acceptedAt: status === "accepted" ? now : null });
  };
  const endpoint = (who: string) => `https://push.example.com/send/${who}`;
  const subscribe = async (cookie: string, who: string) => call(cookie, "POST", "/push/subscriptions", { endpoint: endpoint(who), keys: await browserKeys() });
  const run = () => platform.scheduler.runJob(PUSH_JOB);
  const dueNow = () => o.db.update(pushDeliveries).set({ nextAt: new Date(0) });
  return { o, app, A, B, C, call, snap, befriend, id, subscribe, endpoint, sent, answer, run, dueNow, flags, platform };
}

describe("VAPID key", () => {
  it("is generated on first use, kept in instance_settings and stable across restarts", async () => {
    const t = await mk();
    const first = (await t.call(t.A, "GET", "/push/key")).body.publicKey as string;
    expect(b64.decode(first)).toHaveLength(65);
    expect((await t.call(t.B, "GET", "/push/key")).body.publicKey).toBe(first);
    const [row] = await t.o.db.select().from(instanceSettings).where(eq(instanceSettings.key, VAPID_KEY));
    expect(JSON.parse(row!.value).publicKey).toBe(first);
    const again = createApp({ db: t.o.db, env: { MEALLY_SIGNUP_MODE: "open" }, platform: createNodePlatform({ dataDir, scryptLogN: 10 }), dataDir });
    const res = await again.request("/api/v1/push/key", { headers: { cookie: t.A } });
    expect(((await res.json()) as { publicKey: string }).publicKey).toBe(first);
  });

  it("two first uses at once end up with the same pair", async () => {
    const t = await mk();
    const keys = await Promise.all([t.call(t.A, "GET", "/push/key"), t.call(t.B, "GET", "/push/key")]);
    expect(keys[0]!.body.publicKey).toBe(keys[1]!.body.publicKey);
  });

  it("takes the pair from the environment when both variables are set, and 503s on a bad pair", async () => {
    const ok = await mk();
    const generated = (await ok.call(ok.A, "GET", "/push/key")).body.publicKey as string;
    const [row] = await ok.o.db.select().from(instanceSettings).where(eq(instanceSettings.key, VAPID_KEY));
    const pair = JSON.parse(row!.value) as { publicKey: string; privateKey: string };
    const env = await mk({ MEALLY_VAPID_PUBLIC_KEY: pair.publicKey, MEALLY_VAPID_PRIVATE_KEY: pair.privateKey });
    expect((await env.call(env.A, "GET", "/push/key")).body.publicKey).toBe(generated);
    expect(await env.o.db.select().from(instanceSettings).where(eq(instanceSettings.key, VAPID_KEY))).toHaveLength(0);
    const bad = await mk({ MEALLY_VAPID_PUBLIC_KEY: "nope", MEALLY_VAPID_PRIVATE_KEY: "nope" });
    const res = await bad.call(bad.A, "GET", "/push/key");
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("push_unconfigured");
  });

  it("is behind the push flag and needs a session", async () => {
    const t = await mk();
    expect((await t.app.request("/api/v1/push/key")).status).toBe(401);
    await t.flags.setOverride("push", false);
    expect((await t.call(t.A, "GET", "/push/key")).status).toBe(404);
  });
});

describe("subscriptions", () => {
  it("stores one per endpoint, upserting keys and moving the endpoint to the latest account", async () => {
    const t = await mk();
    expect((await t.subscribe(t.A, "x")).status).toBe(204);
    expect((await t.subscribe(t.A, "x")).status).toBe(204);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(1);
    expect((await t.subscribe(t.B, "x")).status).toBe(204);
    const rows = await t.o.db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(await t.id(t.B));
  });

  it("rejects non-https, private, loopback and odd endpoints with 400", async () => {
    const t = await mk();
    const keys = await browserKeys();
    const bad = [
      "http://push.example.com/x",
      "https://127.0.0.1/x",
      "https://10.0.0.5/x",
      "https://169.254.169.254/latest",
      "https://[::1]/x",
      "https://localhost/x",
      "https://printer.local/x",
      "https://intranet/x",
      "https://user:pw@push.example.com/x",
      "https://push.example.com:8443/x",
      "ftp://push.example.com/x",
    ];
    for (const endpoint of bad) {
      const res = await t.call(t.A, "POST", "/push/subscriptions", { endpoint, keys });
      expect(res.status, endpoint).toBe(400);
    }
    expect((await t.call(t.A, "POST", "/push/subscriptions", { endpoint: "not a url", keys })).status).toBe(400);
    expect((await t.call(t.A, "POST", "/push/subscriptions", { endpoint: t.endpoint("ok"), keys: { p256dh: "", auth: "" } })).status).toBe(400);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("allows http and private hosts only when private URLs are allowed", async () => {
    const t = await mk({ MEALLY_ALLOW_PRIVATE_URLS: "true" });
    const res = await t.call(t.A, "POST", "/push/subscriptions", { endpoint: "http://192.168.1.5:8080/x", keys: await browserKeys() });
    expect(res.status).toBe(204);
  });

  it("keeps the newest few per user and unsubscribes idempotently", async () => {
    const t = await mk();
    for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_USER + 2; i++) {
      await t.subscribe(t.A, `d${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }
    const rows = await t.o.db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect(rows.map((r) => r.endpoint)).not.toContain(t.endpoint("d0"));
    const del = (cookie: string) => t.call(cookie, "DELETE", "/push/subscriptions", { endpoint: t.endpoint("d5") });
    expect((await del(t.B)).status).toBe(204);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect((await del(t.A)).status).toBe(204);
    expect((await del(t.A)).status).toBe(204);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER - 1);
  });
});

describe("sending a Snap pushes to Friends", () => {
  it("queues one delivery per device of each accepted Friend only, and sends them encrypted and VAPID-signed", async () => {
    const t = await mk();
    await t.befriend(t.A, t.B);
    await t.befriend(t.A, t.C, "pending");
    await t.subscribe(t.A, "ann");
    await t.subscribe(t.B, "bo1");
    await t.subscribe(t.B, "bo2");
    await t.subscribe(t.C, "cy");
    const s = await t.snap(t.A);
    expect(s.status).toBe(201);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(2);
    await t.run();
    expect(t.sent.map((x) => x.url).sort()).toEqual([t.endpoint("bo1"), t.endpoint("bo2")]);
    for (const x of t.sent) {
      expect(x.headers["Content-Encoding"]).toBe("aes128gcm");
      expect(x.headers.TTL).toBe("86400");
      expect(x.headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
      expect(x.body[20]).toBe(65);
      expect(x.body.length).toBeGreaterThan(86 + 16);
    }
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
    expect((await t.snap(t.A)).status).toBe(201);
    t.sent.length = 0;
    await t.run();
    expect(t.sent).toHaveLength(2);
  });

  it("does not queue again when a send is retried with the same clientId", async () => {
    const t = await mk();
    await t.befriend(t.A, t.B);
    await t.subscribe(t.B, "bo");
    expect((await t.snap(t.A, "same")).status).toBe(201);
    expect((await t.snap(t.A, "same")).status).toBe(200);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(1);
  });

  it("sends a Reaction push to the Snap's author, once", async () => {
    const t = await mk();
    await t.befriend(t.A, t.B);
    await t.subscribe(t.A, "ann");
    const s = (await t.snap(t.A)).body;
    await t.call(t.B, "PUT", `/snaps/${s.id}/reactions/yum`);
    await t.call(t.B, "DELETE", `/snaps/${s.id}/reactions/yum`);
    await t.call(t.B, "PUT", `/snaps/${s.id}/reactions/yum`);
    const rows = await t.o.db.select().from(pushDeliveries);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toEqual({ type: "reaction", snapId: s.id, from: "Bo", emoji: "yum" });
    await t.run();
    expect(t.sent.map((x) => x.url)).toEqual([t.endpoint("ann")]);
  });
});

describe("delivery outcomes", () => {
  async function queued() {
    const t = await mk();
    await t.befriend(t.A, t.B);
    await t.subscribe(t.B, "bo");
    await t.snap(t.A);
    return t;
  }

  it("retries 429 and 5xx with backoff and gives up after 3 retries, deleting the row", async () => {
    const t = await queued();
    t.answer.status = 503;
    await t.run();
    let [row] = await t.o.db.select().from(pushDeliveries);
    expect(row!.attempt).toBe(1);
    expect(row!.nextAt.getTime()).toBeGreaterThan(Date.now());
    await t.run();
    expect(t.sent).toHaveLength(1);
    t.answer.status = 429;
    for (const attempt of [2, 3]) {
      await t.dueNow();
      await t.run();
      [row] = await t.o.db.select().from(pushDeliveries);
      expect(row!.attempt).toBe(attempt);
    }
    await t.dueNow();
    await t.run();
    expect(t.sent).toHaveLength(4);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("retries a network failure or timeout like a 5xx", async () => {
    const t = await queued();
    t.answer.status = "throw";
    await t.run();
    const [row] = await t.o.db.select().from(pushDeliveries);
    expect(row!.attempt).toBe(1);
  });

  it("deletes the subscription and its queue when the push service says 404 or 410", async () => {
    for (const status of [404, 410]) {
      const t = await queued();
      t.answer.status = status;
      await t.run();
      expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(0);
      expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
    }
  });

  it("gives up without retrying on other 4xx, keeping the subscription", async () => {
    const t = await queued();
    t.answer.status = 403;
    await t.run();
    expect(t.sent).toHaveLength(1);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("treats a redirect as a failure (never followed)", async () => {
    const t = await queued();
    t.answer.status = 302;
    await t.run();
    const [row] = await t.o.db.select().from(pushDeliveries);
    expect(row!.attempt).toBe(1);
  });

  it("two overlapping runs send a delivery once (lease)", async () => {
    const t = await queued();
    await Promise.all([t.run(), t.run()]);
    expect(t.sent).toHaveLength(1);
  });

  it("a delivery claimed by a crashed run comes back after its lease", async () => {
    const t = await queued();
    await t.o.db.update(pushDeliveries).set({ nextAt: new Date(Date.now() + 60_000) });
    await t.run();
    expect(t.sent).toHaveLength(0);
    await t.dueNow();
    await t.run();
    expect(t.sent).toHaveLength(1);
  });

  it("a fetcher that blocks the address (400) removes the subscription", async () => {
    const t = await queued();
    t.answer.status = "blocked";
    await t.run();
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(0);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
  });
});

describe("delivery rechecks at claim time", () => {
  async function queued() {
    const t = await mk();
    await t.befriend(t.A, t.B);
    await t.subscribe(t.B, "bo");
    const s = (await t.snap(t.A)).body;
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(1);
    return { ...t, s };
  }

  it("drops it when the Friendship was removed after queueing", async () => {
    const t = await queued();
    await t.o.db.delete(friendships);
    await t.run();
    expect(t.sent).toHaveLength(0);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it("drops it when the Snap was deleted", async () => {
    const t = await queued();
    expect((await t.call(t.A, "DELETE", `/snaps/${t.s.id}`)).status).toBe(204);
    await t.run();
    expect(t.sent).toHaveLength(0);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it("drops it when the push flag was turned off", async () => {
    const t = await queued();
    await t.flags.setOverride("push", false);
    await t.run();
    expect(t.sent).toHaveLength(0);
    expect(await t.o.db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it("removes a subscription whose stored endpoint is no longer allowed, without sending", async () => {
    const t = await queued();
    await t.o.db.update(pushSubscriptions).set({ endpoint: "https://10.0.0.5/x" });
    await t.run();
    expect(t.sent).toHaveLength(0);
    expect(await t.o.db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});
