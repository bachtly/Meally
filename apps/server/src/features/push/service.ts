import { randomUUID } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { PushPayload, PushSubscribeInput } from "@meally/shared";
import { queryRows, type Db } from "../../db/core.js";
import { instanceSettings, pushDeliveries, pushSubscriptions, snaps, users } from "../../db/schema/index.js";
import { authoredByViewerOrFriend } from "../../lib/access.js";
import { ApiError } from "../../lib/errors.js";
import type { Scheduler } from "../../ports/index.js";
import { createNodeScheduler } from "../../adapters/timer-scheduler.js";
import type { FlagsService } from "../features/service.js";
import { checkUrlShape, type Fetcher } from "../import-url/fetch.js";
import { isBlockedIp, isIP } from "../import-url/ssrf.js";
import { MAX_RETRIES, retryDelayMs } from "../webhooks/service.js";
import { encryptPayload, generateVapidKeys, importVapidPrivate, MAX_PAYLOAD_BYTES, vapidAuthorization, type VapidKeys } from "./webpush.js";

export const PUSH_JOB = "push.deliver";
export const VAPID_KEY = "vapid_keys";
/** A claimed delivery is leased this long; a crashed worker's delivery becomes due again afterwards. */
const LEASE_MS = 5 * 60_000;
const BATCH = 20;
/** The push service may hold a message this long (seconds) while the device is offline. */
const TTL_SECONDS = 24 * 3600;
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

type Tx = Pick<Db, "select" | "insert" | "execute">;

/**
 * A subscription endpoint is a URL the server will POST to, so it gets the same SSRF rules as webhooks and
 * imports: https only (http only when private URLs are allowed), no credentials, no odd ports, no private or
 * blocked addresses. Delivery vets the DNS answer again through the fetcher.
 */
export function assertPushEndpoint(raw: string, allowPrivate: boolean): URL {
  const url = checkUrlShape(raw, allowPrivate);
  if (url.protocol !== "https:" && !allowPrivate) throw new ApiError(400, "invalid_endpoint", "Push endpoints must start with https://");
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const blocked = isIP(host) ? isBlockedIp(host) : !host.includes(".") || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host);
    if (blocked) throw new ApiError(400, "blocked_url", "That address is not allowed");
  }
  return url;
}

/** Queues one push per device of every accepted Friend of the author. Runs inside the Snap's transaction. */
export async function enqueueSnapPush(tx: Tx, authorId: string, snapId: string, now: Date): Promise<void> {
  const subs = await queryRows<{ id: string }>(
    tx as Db,
    sql`SELECT ps.id FROM push_subscriptions ps JOIN friendships f ON f.status = 'accepted'
      AND ((f.user_a_id = ${authorId} AND f.user_b_id = ps.user_id) OR (f.user_b_id = ${authorId} AND f.user_a_id = ps.user_id))`,
  );
  await enqueue(tx, subs, { type: "snap", snapId, from: await nameOf(tx, authorId) }, now);
}

/** Queues one push per device of the Snap's author. Runs inside the Reaction's transaction. */
export async function enqueueReactionPush(tx: Tx, authorId: string, reactorId: string, snapId: string, emoji: string, now: Date): Promise<void> {
  const subs = await tx.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, authorId));
  await enqueue(tx, subs, { type: "reaction", snapId, from: await nameOf(tx, reactorId), emoji }, now);
}

async function nameOf(tx: Tx, userId: string): Promise<string> {
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
  return (u?.name ?? "Someone").slice(0, 100);
}

async function enqueue(tx: Tx, subs: { id: string }[], payload: PushPayload, now: Date) {
  if (!subs.length || new TextEncoder().encode(JSON.stringify(payload)).length > MAX_PAYLOAD_BYTES) return;
  await tx.insert(pushDeliveries).values(subs.map((s) => ({ id: randomUUID(), subscriptionId: s.id, payload, nextAt: now })));
}

export interface PushDeps {
  db: Db;
  fetcher: Fetcher;
  flags: FlagsService;
  scheduler?: Scheduler;
  env?: Record<string, string | undefined>;
  allowPrivate?: boolean;
  now?: () => Date;
  random?: () => number;
  log?: (line: string) => void;
}

export function createPushService({
  db,
  fetcher,
  flags,
  scheduler = createNodeScheduler(),
  env = {},
  allowPrivate = false,
  now = () => new Date(),
  random = () => Math.random(),
  log = (line) => console.info(line),
}: PushDeps) {
  let cached: VapidKeys | null = null;

  /**
   * The VAPID pair: MEALLY_VAPID_PUBLIC_KEY and MEALLY_VAPID_PRIVATE_KEY when both are set, else the pair kept in
   * `instance_settings`, generated on first use. Two first uses racing: the insert picks one winner and both read it.
   */
  async function keys(): Promise<VapidKeys> {
    if (cached) return cached;
    let found: VapidKeys | null = null;
    if (env.MEALLY_VAPID_PUBLIC_KEY && env.MEALLY_VAPID_PRIVATE_KEY) {
      found = { publicKey: env.MEALLY_VAPID_PUBLIC_KEY, privateKey: env.MEALLY_VAPID_PRIVATE_KEY };
    } else {
      const read = async () => {
        const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, VAPID_KEY)).limit(1);
        return row ? (JSON.parse(row.value) as VapidKeys) : null;
      };
      found = await read();
      if (!found) {
        await db.insert(instanceSettings).values({ key: VAPID_KEY, value: JSON.stringify(await generateVapidKeys()) }).onConflictDoNothing();
        found = await read();
      }
    }
    if (!found) throw new ApiError(503, "push_unconfigured", "Push is not configured");
    try {
      await importVapidPrivate(found);
    } catch {
      throw new ApiError(503, "push_unconfigured", "The VAPID keys are not valid");
    }
    return (cached = found);
  }

  /** `sub` claim of the VAPID token: the push service contacts this if we misbehave. */
  const subject = () => {
    const given = env.MEALLY_VAPID_SUBJECT;
    if (given && /^(mailto:|https:\/\/)/.test(given)) return given;
    const base = env.BASE_URL;
    return base?.startsWith("https://") ? new URL(base).origin : "mailto:admin@meally.invalid";
  };

  async function publicKey(): Promise<string> {
    return (await keys()).publicKey;
  }

  async function subscribe(userId: string, input: PushSubscribeInput): Promise<void> {
    assertPushEndpoint(input.endpoint, allowPrivate);
    await db.transaction(async (tx) => {
      // The same browser signing in as someone else: the endpoint moves to the new account and the old one's queue goes with it.
      await tx.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, input.endpoint), ne(pushSubscriptions.userId, userId)));
      await tx
        .insert(pushSubscriptions)
        .values({ id: randomUUID(), userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth, createdAt: now() })
        .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: input.keys.p256dh, auth: input.keys.auth } });
      const mine = await tx
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .orderBy(desc(pushSubscriptions.createdAt), desc(pushSubscriptions.id));
      for (const old of mine.slice(MAX_SUBSCRIPTIONS_PER_USER)) await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.id, old.id));
    });
  }

  /** Deleting one that is not there is fine (idempotent). */
  async function unsubscribe(userId: string, endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
  }

  /** Wakes the job after a commit that queued pushes. A job with nothing due does nothing. */
  const kick = () => scheduler.runAfter(PUSH_JOB, 0);

  type Claimed = { id: string; subscription_id: string; payload: PushPayload; attempt: number };

  async function dropSubscription(id: string, why: string) {
    log(`push: subscription ${id} removed (${why})`);
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  }

  /** After a failure: schedule the next try, or give up once the retries are used. */
  async function failed(d: Claimed, why: string) {
    const attempt = d.attempt + 1;
    if (attempt > MAX_RETRIES) {
      log(`push: gave up on delivery ${d.id} after ${attempt} attempts (${why})`);
      await db.delete(pushDeliveries).where(eq(pushDeliveries.id, d.id));
      return;
    }
    log(`push: delivery ${d.id} attempt ${attempt} failed (${why}), retrying`);
    await db
      .update(pushDeliveries)
      .set({ attempt, nextAt: new Date(now().getTime() + retryDelayMs(d.attempt, random)) })
      .where(eq(pushDeliveries.id, d.id));
  }

  /** Everything that can have changed since the row was queued is checked again here, not trusted from enqueue time. */
  async function deliverOne(d: Claimed, pushOn: boolean) {
    const drop = () => db.delete(pushDeliveries).where(eq(pushDeliveries.id, d.id));
    if (!pushOn) return drop();
    const [sub] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, d.subscription_id)).limit(1);
    if (!sub) return drop();
    try {
      assertPushEndpoint(sub.endpoint, allowPrivate);
    } catch {
      return dropSubscription(sub.id, "endpoint no longer allowed");
    }
    // The recipient must still be able to see the Snap (author, or an accepted Friend of the author).
    const [visible] = await db
      .select({ id: snaps.id })
      .from(snaps)
      .where(and(eq(snaps.id, d.payload.snapId), authoredByViewerOrFriend(snaps.userId, { userId: sub.userId })))
      .limit(1);
    if (!visible) return drop();

    const started = Date.now();
    let status = 0;
    try {
      const vapid = await keys();
      const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(d.payload)), sub.p256dh, sub.auth);
      const res = await fetcher(sub.endpoint, {
        kind: "post",
        body,
        headers: {
          Authorization: await vapidAuthorization(vapid, sub.endpoint, subject(), now().getTime()),
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          TTL: String(TTL_SECONDS),
          Urgency: "normal",
        },
      });
      status = res.status ?? 0;
    } catch (e) {
      if (e instanceof ApiError && e.status === 400) return dropSubscription(sub.id, "endpoint blocked");
      if (e instanceof Error && /Invalid push keys|too large/.test(e.message)) return dropSubscription(sub.id, "unusable keys");
      return failed(d, e instanceof Error ? e.message : "send failed");
    }
    log(`push: delivery ${d.id} answered ${status} in ${Date.now() - started} ms`);
    if (status >= 200 && status < 300) return drop();
    if (status === 404 || status === 410) return dropSubscription(sub.id, `gone (${status})`);
    if (status === 429 || status >= 500 || (status >= 300 && status < 400)) return failed(d, `status ${status}`);
    log(`push: delivery ${d.id} rejected with ${status}, giving up`);
    return drop();
  }

  /**
   * Sends every due delivery. Rows are claimed with UPDATE ... RETURNING over FOR UPDATE SKIP LOCKED (a lease: next_at is
   * pushed out), so two overlapping runs never send one delivery twice. Rows are deleted on success and on give-up.
   */
  async function runDeliveries(): Promise<number> {
    const at = now();
    const claimed = await queryRows<Claimed>(
      db,
      sql`UPDATE push_deliveries SET next_at = ${new Date(at.getTime() + LEASE_MS).toISOString()}::timestamptz
        WHERE id IN (SELECT id FROM push_deliveries WHERE next_at <= ${at.toISOString()}::timestamptz ORDER BY next_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, subscription_id, payload, attempt`,
    );
    if (!claimed.length) return 0;
    const pushOn = (await flags.getFeatures()).push.enabled;
    for (const d of claimed) {
      try {
        await deliverOne(d, pushOn);
      } catch {
        /* the lease expires and the delivery runs again */
      }
    }
    return claimed.length;
  }

  // Always defined (a platform cron calls it by name); the timer is started separately.
  scheduler.define(PUSH_JOB, async () => void (await runDeliveries()));

  return {
    publicKey,
    subscribe,
    unsubscribe,
    runDeliveries,
    kick,
    start() {
      scheduler.every(PUSH_JOB, 60_000);
    },
  };
}
export type PushService = ReturnType<typeof createPushService>;
