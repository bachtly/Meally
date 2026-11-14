import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { PushPayload, PushSubscribeInput } from "@meally/shared";
import { queryRows, type Db } from "../../db/core.js";
import { instanceSettings, pushDeliveries, pushSubscriptions, users } from "../../db/schema/index.js";
import { acceptedFriendIds, type Viewer } from "../../lib/access.js";
import { ApiError } from "../../lib/errors.js";
import type { Scheduler } from "../../ports/index.js";
import type { FlagsService } from "../features/service.js";
import type { Fetcher } from "../import-url/fetch.js";
import { encryptPayload, generateVapidKeys, validVapidKeys, vapidAuthorization, type VapidKeys } from "./webpush.js";

export const PUSH_JOB = "push.deliver";
const VAPID_KEY = "vapid_keys";

/**
 * The browser push services we send to. Anything else is refused at subscribe time, so a subscription can't
 * point the server at an internal address (SSRF); the fetcher's private-address check backs this up.
 */
const PUSH_HOSTS = ["fcm.googleapis.com", "android.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];

export function assertPushEndpoint(endpoint: string) {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new ApiError(400, "invalid_body", "endpoint: not a valid URL");
  }
  const known = PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  if (u.protocol !== "https:" || !known || u.username || u.password || (u.port && u.port !== "443")) {
    throw new ApiError(400, "unsupported_endpoint", "This browser's push service isn't supported");
  }
}

/** `mailto:` or `https:` contact sent to push services: MEALLY_VAPID_SUBJECT, else the instance URL, else a placeholder. */
function subjectFrom(env: Record<string, string | undefined>) {
  const s = env.MEALLY_VAPID_SUBJECT;
  if (s && /^(mailto:|https:\/\/)/.test(s)) return s;
  const base = env.BASE_URL;
  if (base?.startsWith("https://")) return new URL(base).origin;
  return "mailto:push@meally.invalid";
}

const keyCache = new WeakMap<Db, Promise<VapidKeys | null>>();

/**
 * The instance's VAPID keys. MEALLY_VAPID_PUBLIC_KEY and MEALLY_VAPID_PRIVATE_KEY win when both are set and valid;
 * otherwise a pair is generated once and kept in `instance_settings`, so push works without setup. Two servers
 * starting together both try to insert; the first row wins and both read it back. `null` means push is off.
 */
export function vapidKeys(db: Db, env: Record<string, string | undefined>): Promise<VapidKeys | null> {
  let p = keyCache.get(db);
  if (!p) {
    p = (async () => {
      const subject = subjectFrom(env);
      const pub = env.MEALLY_VAPID_PUBLIC_KEY;
      const priv = env.MEALLY_VAPID_PRIVATE_KEY;
      if (pub || priv) {
        if (pub && priv && (await validVapidKeys({ publicKey: pub, privateKey: priv }))) return { publicKey: pub, privateKey: priv, subject };
        console.error("push: MEALLY_VAPID_PUBLIC_KEY and MEALLY_VAPID_PRIVATE_KEY must both be set to a valid P-256 pair; push is off");
        return null;
      }
      const read = async () => {
        const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, VAPID_KEY)).limit(1);
        return row ? (JSON.parse(row.value) as { publicKey: string; privateKey: string }) : null;
      };
      let stored = await read();
      if (!stored) {
        await db.insert(instanceSettings).values({ key: VAPID_KEY, value: JSON.stringify(await generateVapidKeys()) }).onConflictDoNothing();
        stored = await read();
      }
      return stored ? { ...stored, subject } : null;
    })();
    // A failed read (database not ready) is retried on the next call instead of being cached.
    p.catch(() => keyCache.delete(db));
    keyCache.set(db, p);
  }
  return p;
}

/** Saves this browser's subscription for the viewer. The endpoint is unique: re-subscribing from another account moves it. */
export async function subscribe(db: Db, viewer: Viewer, input: PushSubscribeInput): Promise<{ id: string; created: boolean }> {
  assertPushEndpoint(input.endpoint);
  const [had] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, input.endpoint)).limit(1);
  const [row] = await db
    .insert(pushSubscriptions)
    .values({ id: randomUUID(), userId: viewer.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, createdAt: new Date() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { userId: viewer.userId, p256dh: input.keys.p256dh, auth: input.keys.auth } })
    .returning({ id: pushSubscriptions.id });
  return { id: row!.id, created: !had };
}

/** Owner-only. Its queued deliveries go with it (cascade). */
export async function unsubscribe(db: Db, viewer: Viewer, id: string): Promise<void> {
  const gone = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.userId, viewer.userId)))
    .returning({ id: pushSubscriptions.id });
  if (!gone.length) throw new ApiError(404, "not_found", "Subscription not found");
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Queues one push per device of each of the author's Friends. Runs inside the transaction that inserts the Snap. */
export async function queueSnapPush(tx: Tx, author: Viewer, snapId: string, now: Date): Promise<number> {
  const subs = await tx
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(sql`${pushSubscriptions.userId} IN (${acceptedFriendIds(author)})`);
  if (!subs.length) return 0;
  const [me] = await tx.select({ name: users.name }).from(users).where(eq(users.id, author.userId)).limit(1);
  const payload: PushPayload = { type: "snap", snapId, from: (me?.name ?? "Someone").slice(0, 100) };
  await tx.insert(pushDeliveries).values(subs.map((s) => ({ id: randomUUID(), subscriptionId: s.id, payload, nextAt: now })));
  return subs.length;
}

/** 3 retries with full-jitter backoff, as webhooks, then the push is dropped. */
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 15 * 60_000;
const LEASE_MS = 2 * 60_000;
const BATCH = 50;
/** How long a push service keeps an undelivered message: a day-old Snap alert is still worth showing. */
const TTL_SECONDS = 86_400;

export type SendOutcome = "sent" | "gone" | "retry" | "drop";

/** What a push service answer means: 201 sent, 404/410 the subscription is dead (AC-4.5), 429/5xx try again. */
export function outcomeOf(status: number | null): SendOutcome {
  if (status === null) return "retry";
  if (status >= 200 && status < 300) return "sent";
  if (status === 404 || status === 410) return "gone";
  if (status === 429 || status >= 500) return "retry";
  return "drop";
}

export interface DelivererDeps {
  db: Db;
  scheduler: Scheduler;
  fetcher: Fetcher;
  flags: FlagsService;
  env: Record<string, string | undefined>;
  now?: () => Date;
  random?: () => number;
  /** Send right after queueing. Off in tests (they call `runDue`) and wherever background jobs are off. */
  sendNow?: boolean;
}

export function createPushDeliverer({ db, scheduler, fetcher, flags, env, now = () => new Date(), random = Math.random, sendNow = true }: DelivererDeps) {
  /**
   * Sends every due push. Rows are claimed by pushing `next_at` out (a lease) over FOR UPDATE SKIP LOCKED, so two
   * overlapping runs never send the same row; a crash mid-batch only re-sends after the lease, and the service
   * worker tags notifications by Snap so a repeat replaces the first.
   */
  async function runDue(): Promise<{ sent: number; gone: number; retried: number; dropped: number }> {
    const tally = { sent: 0, gone: 0, retried: 0, dropped: 0 };
    const at = now();
    const on = (await flags.getFeatures()).push?.enabled;
    const keys = on ? await vapidKeys(db, env) : null;
    if (!keys) {
      // Push is off: due rows are dropped rather than piling up for when it comes back.
      await db.execute(sql`DELETE FROM push_deliveries WHERE next_at <= ${at.toISOString()}::timestamptz`);
      return tally;
    }
    const claimed = await queryRows<{ id: string; subscription_id: string; payload: PushPayload; attempt: number }>(
      db,
      sql`UPDATE push_deliveries SET next_at = ${new Date(at.getTime() + LEASE_MS).toISOString()}::timestamptz
        WHERE id IN (SELECT id FROM push_deliveries WHERE next_at <= ${at.toISOString()}::timestamptz ORDER BY next_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, subscription_id, payload, attempt`,
    );
    if (!claimed.length) return tally;
    const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.id, [...new Set(claimed.map((r) => r.subscription_id))]));
    const byId = new Map(subs.map((s) => [s.id, s]));
    for (const row of claimed) {
      const sub = byId.get(row.subscription_id);
      try {
        if (!sub) {
          await db.delete(pushDeliveries).where(eq(pushDeliveries.id, row.id));
          continue;
        }
        let status: number | null = null;
        try {
          const payload = typeof row.payload === "string" ? (JSON.parse(row.payload) as PushPayload) : row.payload;
          const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), sub);
          const res = await fetcher(sub.endpoint, {
            kind: "post",
            body,
            headers: {
              Authorization: await vapidAuthorization(sub.endpoint, keys, at.getTime()),
              "Content-Encoding": "aes128gcm",
              "Content-Type": "application/octet-stream",
              TTL: String(TTL_SECONDS),
              Urgency: "normal",
            },
          });
          status = res.status ?? null;
        } catch {
          status = null; // timeout, DNS, refused: try again
        }
        const outcome = outcomeOf(status);
        if (outcome === "gone") {
          // Unsubscribed or expired in the browser: forget the device (its other deliveries cascade).
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
          tally.gone++;
          continue;
        }
        if (outcome === "retry" && row.attempt + 1 < MAX_ATTEMPTS) {
          const delay = Math.floor(random() * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** row.attempt));
          await db.update(pushDeliveries).set({ attempt: row.attempt + 1, nextAt: new Date(at.getTime() + delay) }).where(eq(pushDeliveries.id, row.id));
          tally.retried++;
          continue;
        }
        await db.delete(pushDeliveries).where(eq(pushDeliveries.id, row.id));
        if (outcome === "sent") tally.sent++;
        else {
          tally.dropped++;
          console.error(`push: gave up on a delivery after status ${status ?? "no answer"}`);
        }
      } catch {
        /* the lease runs out and the row is tried again */
      }
    }
    return tally;
  }

  scheduler.define(PUSH_JOB, async () => void (await runDue()));

  return {
    runDue,
    /** Sends what was just queued, without waiting for the next tick (a no-op on the edge, where pg_cron runs it). */
    kick: () => {
      if (sendNow) scheduler.runAfter(PUSH_JOB, 0);
    },
    /** Picks up retries and anything a crash left behind. */
    start: () => scheduler.every(PUSH_JOB, 60_000),
  };
}

export type PushDeliverer = ReturnType<typeof createPushDeliverer>;
