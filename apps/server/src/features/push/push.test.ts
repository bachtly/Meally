import { webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { createNodeScheduler } from "../../adapters/timer-scheduler.js";
import { friendships, pushDeliveries, pushSubscriptions } from "../../db/schema/index.js";
import { openTestDb } from "../../db/testing.js";
import { createFlagsService } from "../features/service.js";
import type { Fetcher } from "../import-url/fetch.js";
import { assertPushEndpoint, createPushDeliverer, outcomeOf } from "./service.js";
import { b64url, encryptPayload, fromB64url, generateVapidKeys, vapidAuthorization } from "./webpush.js";

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

/** The browser's side of RFC 8291, written from the spec, to check our encryption end to end. */
async function decrypt(body: Uint8Array, ua: webcrypto.CryptoKeyPair, auth: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLen = body[20]!;
  const serverPublic = body.slice(21, 21 + idLen);
  const sealed = body.slice(21 + idLen);
  expect(rs).toBe(4096);
  const uaPublic = new Uint8Array(await subtle.exportKey("raw", ua.publicKey));
  const sKey = await subtle.importKey("raw", serverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const secret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: sKey }, ua.privateKey, 256));
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s, info }, await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]), n * 8));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...serverPublic]);
  const ikm = await hkdf(auth, secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, sealed));
  expect(plain.at(-1)).toBe(2); // last-record delimiter
  return new TextDecoder().decode(plain.slice(0, -1));
}

async function browserKeys() {
  const ua = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as webcrypto.CryptoKeyPair;
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const p256dh = b64url(new Uint8Array(await subtle.exportKey("raw", ua.publicKey)));
  return { ua, auth, keys: { p256dh, auth: b64url(auth) } };
}

describe("Web Push crypto", () => {
  it("encrypts a payload the browser can decrypt (RFC 8291), fresh per message", async () => {
    const b = await browserKeys();
    const msg = JSON.stringify({ type: "snap", snapId: "s1", from: "Ann" });
    const one = await encryptPayload(enc.encode(msg), b.keys);
    const two = await encryptPayload(enc.encode(msg), b.keys);
    expect(await decrypt(one, b.ua, b.auth)).toBe(msg);
    expect(await decrypt(two, b.ua, b.auth)).toBe(msg);
    expect(b64url(one)).not.toBe(b64url(two));
  });

  it("signs a VAPID JWT the push service can verify (RFC 8292)", async () => {
    const k = { ...(await generateVapidKeys()), subject: "mailto:ops@example.com" };
    const auth = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", k, Date.UTC(2026, 10, 14) );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth)!;
    expect(m[4]).toBe(k.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(m[2]!)));
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: Date.UTC(2026, 10, 14) / 1000 + 12 * 3600, sub: "mailto:ops@example.com" });
    const pub = await subtle.importKey("raw", fromB64url(k.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const ok = await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(m[3]!), enc.encode(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });

  it("accepts only known browser push services over https", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/x", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://wns2-par02p.notify.windows.com/w/?token=x"])
      expect(() => assertPushEndpoint(ok)).not.toThrow();
    for (const bad of ["http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://evil.example/x", "https://fcm.googleapis.com.evil.example/x", "https://fcm.googleapis.com:8443/x", "https://u:p@fcm.googleapis.com/x"])
      expect(() => assertPushEndpoint(bad)).toThrow();
  });

  it("maps push service answers to outcomes", () => {
    expect([201, 404, 410, 429, 500, 503, 400, 413, null].map(outcomeOf)).toEqual(["sent", "gone", "gone", "retry", "retry", "retry", "drop", "drop", "retry"]);
  });
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "meally-push-"));
afterAll(() => fs.rmSync(dataDir, { recursive: true, force: true }));
const H = { "content-type": "application/json", "x-requested-with": "meally" };

async function mk(env: Record<string, string> = {}) {
  const o = openTestDb();
  const allEnv = { MEALLY_SIGNUP_MODE: "open", ...env };
  const app = createApp({ db: o.db, env: allEnv, scryptLogN: 10, dataDir });
  await o.ready;
  const reg = async (p: "setup" | "register", email: string, name: string) => {
    const res = await app.request(`/api/v1/auth/${p}`, { method: "POST", headers: H, body: JSON.stringify({ email, name, password: "correct horse" }) });
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };
  const call = async (cookie: string, method: string, p: string, body?: unknown) => {
    const res = await app.request(`/api/v1${p}`, { method, headers: { ...H, cookie }, body: body ? JSON.stringify(body) : undefined });
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : null };
  };
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#c33" } }).png().toBuffer();
  const send = async (cookie: string, clientId: string) => {
    const form = new FormData();
    form.set("clientId", clientId);
    form.set("file", new File([new Uint8Array(png)], "x.png", { type: "image/png" }));
    return (await app.request("/api/v1/snaps", { method: "POST", headers: { cookie, "x-requested-with": "meally" }, body: form })).status;
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
  const sub = async (cookie: string, n: string) => {
    const b = await browserKeys();
    const r = await call(cookie, "POST", "/push/subscriptions", { endpoint: `https://fcm.googleapis.com/fcm/send/${n}`, keys: b.keys });
    return { ...r, browser: b };
  };
  const sent: Array<{ url: string; body: Uint8Array; headers: Record<string, string> }> = [];
  const answers: Array<number | "throw"> = [];
  const fetcher: Fetcher = async (url, opts) => {
    sent.push({ url, body: opts.body as Uint8Array, headers: opts.headers! });
    const a = answers.shift() ?? 201;
    if (a === "throw") throw new Error("timeout");
    return { body: Buffer.alloc(0), contentType: "", finalUrl: url, status: a };
  };
  // A minute ahead, so pushes queued during the test are already due.
  let clock = Date.now() + 60_000;
  const deliverer = createPushDeliverer({ db: o.db, scheduler: createNodeScheduler(), fetcher, flags: createFlagsService(o.db, allEnv), env: allEnv, now: () => new Date(clock), random: () => 0.5 });
  const later = (ms: number) => (clock += ms);
  return { o, A, B, C, call, send, link, sub, sent, answers, deliverer, later };
}

describe("push subscriptions", () => {
  it("serves one stable public key, saves a subscription once per endpoint, and deletes only your own", async () => {
    const { o, A, B, call, sub } = await mk();
    const k1 = await call(A, "GET", "/push/key");
    const k2 = await call(B, "GET", "/push/key");
    expect(k1.status).toBe(200);
    expect(fromB64url(k1.body.publicKey)).toHaveLength(65);
    expect(k2.body.publicKey).toBe(k1.body.publicKey);

    const first = await sub(A, "dev1");
    expect(first.status).toBe(201);
    const again = await call(B, "POST", "/push/subscriptions", { endpoint: "https://fcm.googleapis.com/fcm/send/dev1", keys: first.browser.keys });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    const [row] = await o.db.select().from(pushSubscriptions);
    expect(row!.userId).not.toBe(undefined);

    expect((await call(A, "DELETE", `/push/subscriptions/${first.body.id}`)).status).toBe(404); // moved to B
    expect((await call(B, "DELETE", `/push/subscriptions/${first.body.id}`)).status).toBe(204);
    expect(await o.db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("refuses endpoints that aren't a browser push service, and bad bodies", async () => {
    const { A, call } = await mk();
    const keys = (await browserKeys()).keys;
    expect((await call(A, "POST", "/push/subscriptions", { endpoint: "https://169.254.169.254/latest", keys })).status).toBe(400);
    expect((await call(A, "POST", "/push/subscriptions", { endpoint: "http://fcm.googleapis.com/x", keys })).status).toBe(400);
    expect((await call(A, "POST", "/push/subscriptions", { endpoint: "https://fcm.googleapis.com/x" })).status).toBe(400);
  });

  it("uses keys from the environment when both are set", async () => {
    const pair = await generateVapidKeys();
    const { A, call } = await mk({ MEALLY_VAPID_PUBLIC_KEY: pair.publicKey, MEALLY_VAPID_PRIVATE_KEY: pair.privateKey });
    expect((await call(A, "GET", "/push/key")).body.publicKey).toBe(pair.publicKey);
  });

  it("returns 503 when the environment keys are broken, and 404 with the push flag off", async () => {
    const { A, call } = await mk({ MEALLY_VAPID_PUBLIC_KEY: "nope", MEALLY_VAPID_PRIVATE_KEY: "nope" });
    expect((await call(A, "GET", "/push/key")).status).toBe(503);
    const off = await mk({ MEALLY_FEATURE_PUSH: "off" });
    expect((await off.call(off.A, "GET", "/push/key")).status).toBe(404);
  });
});

describe("push delivery", () => {
  it("a new Snap notifies each Friend's devices, encrypted and VAPID-signed; nobody else", async () => {
    const { o, A, B, C, link, sub, send, sent, deliverer } = await mk();
    await link(A, B, "accepted");
    await link(A, C, "pending");
    const bo = await sub(B, "bo");
    await sub(C, "cy");
    await sub(A, "ann");
    expect(await send(A, "s1")).toBe(201);
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(1);
    expect(await send(A, "s1")).toBe(200); // a retried send queues nothing more
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(1);

    expect(await deliverer.runDue()).toEqual({ sent: 1, gone: 0, retried: 0, dropped: 0 });
    expect(sent).toHaveLength(1);
    const s = sent[0]!;
    expect(s.url).toBe("https://fcm.googleapis.com/fcm/send/bo");
    expect(s.headers).toMatchObject({ "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "86400" });
    expect(s.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    const payload = JSON.parse(await decrypt(s.body, bo.browser.ua, bo.browser.auth));
    expect(payload).toMatchObject({ type: "snap", from: "Ann" });
    expect(payload.snapId).toBeTruthy();
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it("a Reaction notifies the author", async () => {
    const { o, A, B, call, link, sub, send, sent, deliverer } = await mk();
    await link(A, B, "accepted");
    const ann = await sub(A, "ann");
    await send(A, "s1");
    const feed = await call(B, "GET", "/snaps");
    await call(B, "PUT", `/snaps/${feed.body.items[0].id}/reactions/heart`);
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(1);
    await deliverer.runDue();
    expect(JSON.parse(await decrypt(sent[0]!.body, ann.browser.ua, ann.browser.auth))).toMatchObject({ type: "reaction", from: "Bo", emoji: "heart" });
  });

  it("forgets a device the push service says is gone (404/410)", async () => {
    const { o, A, B, link, sub, send, answers, deliverer } = await mk();
    await link(A, B, "accepted");
    await sub(B, "bo");
    await send(A, "s1");
    answers.push(410);
    expect((await deliverer.runDue()).gone).toBe(1);
    expect(await o.db.select().from(pushSubscriptions).then((r) => r.map((x) => x.endpoint))).not.toContain("https://fcm.googleapis.com/fcm/send/bo");
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(0);
  });

  it("retries 5xx, 429 and timeouts with backoff, then gives up after 3 attempts", async () => {
    const { o, A, B, link, sub, send, answers, deliverer, later, sent } = await mk();
    await link(A, B, "accepted");
    await sub(B, "bo");
    await send(A, "s1");
    answers.push(503, "throw", 429);
    expect((await deliverer.runDue()).retried).toBe(1);
    const [row] = await o.db.select().from(pushDeliveries);
    expect(row!.attempt).toBe(1);
    expect((await deliverer.runDue()).retried).toBe(0); // not due yet
    later(60 * 60_000);
    expect((await deliverer.runDue()).retried).toBe(1);
    later(60 * 60_000);
    expect((await deliverer.runDue()).dropped).toBe(1);
    expect(sent).toHaveLength(3);
    expect(await o.db.select().from(pushDeliveries)).toHaveLength(0);
    expect(await o.db.select().from(pushSubscriptions)).toHaveLength(1); // a flaky service doesn't cost the device
  });

  it("two overlapping runs send each push once", async () => {
    const { A, B, link, sub, send, sent, deliverer } = await mk();
    await link(A, B, "accepted");
    await sub(B, "bo1");
    await sub(B, "bo2");
    await send(A, "s1");
    await Promise.all([deliverer.runDue(), deliverer.runDue()]);
    expect(sent.map((s) => s.url).sort()).toEqual(["https://fcm.googleapis.com/fcm/send/bo1", "https://fcm.googleapis.com/fcm/send/bo2"]);
  });
});
