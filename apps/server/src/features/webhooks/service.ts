import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Scheduler } from "../../ports/index.js";
import { createNodeScheduler } from "../../adapters/timer-scheduler.js";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Webhook, WebhookDelivery, WebhookEvent, WebhookWithSecret } from "@meally/shared";
import type { z } from "@meally/shared";
import type { webhookInputSchema } from "@meally/shared";
import { queryRows, type Db } from "../../db/core.js";
import { users, webhookDeliveries, webhookRetries, webhooks } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import type { Fetcher } from "../import-url/fetch.js";
import type { FlagsService } from "../features/service.js";
import { listEntries } from "../mealplan/service.js";
import { registerWebhookEmitter } from "./events.js";

/** Durable retries (webhook_retries table, run by the `webhooks.retry` job): 3 attempts, exponential backoff with full jitter, capped. */
export const MAX_RETRIES = 3;
export const RETRY_BASE_MS = 60_000;
export const RETRY_CAP_MS = 30 * 60_000;
/** Full jitter: uniform in [0, min(cap, base * 2^n)). `random` returns [0, 1). */
export const retryDelayMs = (n: number, random: () => number = Math.random) =>
  Math.floor(random() * Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** n));
export const MAX_FAILURES = 20;
export const KEEP_DELIVERIES = 50;
const DIGEST_WINDOW_MIN = 120;

export type WebhookData = z.output<typeof webhookInputSchema>;
type Row = typeof webhooks.$inferSelect;
const notFound = () => new ApiError(404, "not_found", "Webhook not found");

/** `X-Meally-Signature` value: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`. */
export const sign = (secret: string, body: string, timestamp: number) =>
  `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
/** Deprecated body-only `X-Meally-Signature-256` value (`sha256=<hex>`), kept for one release. */
export const legacySign = (secret: string, body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

/** Webhook URLs must be https unless private URLs are allowed (home labs). */
export function assertWebhookUrl(url: string, allowPrivate: boolean) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ApiError(400, "invalid_url", "Webhook URL is not valid");
  }
  if (u.protocol === "https:" || (allowPrivate && u.protocol === "http:")) return;
  throw new ApiError(400, "invalid_url", "Webhook URLs must start with https:// (set MEALLY_ALLOW_PRIVATE_URLS=true to allow http)");
}
export const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

const toWebhook = (r: Row): Webhook => ({
  id: r.id,
  name: r.name,
  url: r.url,
  events: r.events as WebhookEvent[],
  enabled: r.enabled,
  dailyAt: r.dailyAt,
  tz: r.tz,
  createdAt: r.createdAt.getTime(),
  lastStatus: r.lastStatus,
  lastDeliveryAt: r.lastDeliveryAt?.getTime() ?? null,
  failureCount: r.failureCount,
});
const withSecret = (r: Row): WebhookWithSecret => ({ ...toWebhook(r), secret: r.secret });

async function find(db: Db, userId: string, id: string): Promise<Row> {
  const [r] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).limit(1);
  if (!r) throw notFound();
  return r;
}

export async function listWebhooks(db: Db, userId: string): Promise<Webhook[]> {
  const rows = await db.select().from(webhooks).where(eq(webhooks.userId, userId)).orderBy(webhooks.createdAt);
  return rows.map(toWebhook);
}
export async function getWebhook(db: Db, userId: string, id: string) {
  return withSecret(await find(db, userId, id));
}
export async function createWebhook(db: Db, userId: string, input: WebhookData, allowPrivate = false): Promise<WebhookWithSecret> {
  assertWebhookUrl(input.url, allowPrivate);
  const [r] = await db
    .insert(webhooks)
    .values({
      id: randomUUID(),
      userId,
      name: input.name,
      url: input.url,
      secret: newSecret(),
      events: input.events,
      enabled: input.enabled ?? true,
      dailyAt: input.dailyAt ?? "07:00",
      tz: input.tz ?? "UTC",
      createdAt: new Date(),
    })
    .returning();
  return withSecret(r!);
}
export async function updateWebhook(db: Db, userId: string, id: string, input: WebhookData, allowPrivate = false): Promise<WebhookWithSecret> {
  assertWebhookUrl(input.url, allowPrivate);
  const cur = await find(db, userId, id);
  const enabled = input.enabled ?? cur.enabled;
  const [r] = await db
    .update(webhooks)
    .set({
      name: input.name,
      url: input.url,
      events: input.events,
      enabled,
      dailyAt: input.dailyAt ?? cur.dailyAt,
      tz: input.tz ?? cur.tz,
      // Re-enabling resets the failure streak so the hook gets a fresh run.
      failureCount: enabled && !cur.enabled ? 0 : cur.failureCount,
    })
    .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)))
    .returning();
  return withSecret(r!);
}
export async function deleteWebhook(db: Db, userId: string, id: string) {
  await find(db, userId, id);
  await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));
}
export async function listDeliveries(db: Db, userId: string, id: string): Promise<WebhookDelivery[]> {
  await find(db, userId, id);
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, id))
    .orderBy(desc(webhookDeliveries.createdAt), desc(webhookDeliveries.id))
    .limit(KEEP_DELIVERIES);
  return rows.map((d) => ({
    id: d.id,
    event: d.event,
    statusCode: d.statusCode,
    ok: d.ok,
    error: d.error,
    durationMs: d.durationMs,
    createdAt: d.createdAt.getTime(),
  }));
}

/** Local calendar date and clock time (HH:MM) for an instant in an IANA time zone. */
export function localParts(now: Date, tz: string): { date: string; time: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** True once the owner's local clock passes `dailyAt` (at most 2 h late), once per local day. */
export function digestDue(now: Date, h: { dailyAt: string; tz: string; lastDigestOn: string | null }): { due: boolean; date: string } {
  const { date, time } = localParts(now, h.tz);
  const late = minutes(time) - minutes(h.dailyAt);
  return { due: late >= 0 && late <= DIGEST_WINDOW_MIN && h.lastDigestOn !== date, date };
}

const RETRY_JOB = "webhooks.retry";
const DIGEST_JOB = "mealplan.digest";
/** A claimed retry is leased this long; a crashed worker's retry becomes due again afterwards. */
const RETRY_LEASE_MS = 5 * 60_000;
const RETRY_BATCH = 20;
export interface DispatcherDeps {
  db: Db;
  /** Runs retries and the digest tick; defaults to a private Node scheduler. */
  scheduler?: Scheduler;
  fetcher: Fetcher;
  flags: FlagsService;
  now?: () => Date;
  /** MEALLY_ALLOW_PRIVATE_URLS: lets delivery use http. */
  allowPrivate?: boolean;
  random?: () => number;
}
export interface DeliveryResult {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
  durationMs: number;
}

export function createDispatcher({ db, fetcher, flags, scheduler = createNodeScheduler(), now = () => new Date(), allowPrivate = false, random = () => Math.random() }: DispatcherDeps) {

  async function record(hook: Row, event: string, res: DeliveryResult) {
    const at = now();
    await db.insert(webhookDeliveries).values({
      id: randomUUID(),
      webhookId: hook.id,
      event,
      statusCode: res.statusCode,
      ok: res.ok,
      error: res.error,
      durationMs: res.durationMs,
      createdAt: at,
    });
    await db.execute(sql`DELETE FROM webhook_deliveries WHERE webhook_id = ${hook.id} AND id NOT IN (
      SELECT id FROM webhook_deliveries WHERE webhook_id = ${hook.id} ORDER BY created_at DESC, id DESC LIMIT ${KEEP_DELIVERIES})`);
    const [cur] = await db.select({ failureCount: webhooks.failureCount }).from(webhooks).where(eq(webhooks.id, hook.id)).limit(1);
    if (!cur) return;
    const failures = res.ok ? 0 : cur.failureCount + 1;
    await db
      .update(webhooks)
      .set({ lastStatus: res.statusCode, lastDeliveryAt: at, failureCount: failures, ...(failures >= MAX_FAILURES ? { enabled: false } : {}) })
      .where(eq(webhooks.id, hook.id));
  }

  /** One HTTP attempt: signs the body, posts through the SSRF-safe fetcher and logs the outcome. */
  async function attempt(hook: Row, event: string, body: string): Promise<DeliveryResult> {
    const deliveryId = randomUUID();
    const started = Date.now();
    let res: DeliveryResult;
    try {
      assertWebhookUrl(hook.url, allowPrivate);
      const ts = Math.floor(now().getTime() / 1000);
      const r = await fetcher(hook.url, {
        kind: "post",
        body,
        headers: {
          "Content-Type": "application/json",
          "X-Meally-Event": event,
          "X-Meally-Delivery": deliveryId,
          "X-Meally-Timestamp": String(ts),
          "X-Meally-Signature": sign(hook.secret, body, ts),
          // Deprecated: body-only signature, removed after one release.
          "X-Meally-Signature-256": legacySign(hook.secret, body),
        },
      });
      const status = r.status ?? 0;
      const ok = status >= 200 && status < 300;
      res = {
        ok,
        statusCode: status,
        error: ok ? null : status >= 300 && status < 400 ? "Redirects are not followed" : `Answered with status ${status}`,
        durationMs: Date.now() - started,
      };
    } catch (e) {
      res = { ok: false, statusCode: null, error: e instanceof Error ? e.message : "Delivery failed", durationMs: Date.now() - started };
    }
    await record(hook, event, res);
    return res;
  }

  async function scheduleRetry(hookId: string, event: string, body: string, n: number) {
    if (n >= MAX_RETRIES) return;
    await db.insert(webhookRetries).values({
      id: randomUUID(),
      webhookId: hookId,
      event,
      payload: body,
      attempt: n,
      nextAt: new Date(now().getTime() + retryDelayMs(n, random)),
    });
  }

  /**
   * Sends every due retry. Rows are claimed with UPDATE ... RETURNING over FOR UPDATE SKIP LOCKED (lease
   * by pushing next_at out), so two overlapping runs never send the same retry twice.
   */
  async function runRetries(): Promise<number> {
    const at = now();
    const claimed = await queryRows<{ id: string; webhook_id: string; event: string; payload: string; attempt: number }>(
      db,
      sql`UPDATE webhook_retries SET next_at = ${new Date(at.getTime() + RETRY_LEASE_MS).toISOString()}::timestamptz
        WHERE id IN (SELECT id FROM webhook_retries WHERE next_at <= ${at.toISOString()}::timestamptz ORDER BY next_at LIMIT ${RETRY_BATCH} FOR UPDATE SKIP LOCKED)
        RETURNING id, webhook_id, event, payload, attempt`,
    );
    for (const r of claimed) {
      try {
        const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, r.webhook_id)).limit(1);
        if (hook?.enabled) {
          const res = await attempt(hook, r.event, r.payload);
          if (!res.ok) await scheduleRetry(hook.id, r.event, r.payload, r.attempt + 1);
        }
        await db.delete(webhookRetries).where(eq(webhookRetries.id, r.id));
      } catch {
        /* the lease expires and the retry runs again */
      }
    }
    return claimed.length;
  }
  scheduler.define(RETRY_JOB, async () => void (await runRetries()));
  scheduler.define(DIGEST_JOB, () => tick());

  async function owner(id: string) {
    const [u] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, id)).limit(1);
    return u ?? { id, name: "" };
  }

  /** Sends now. With `retry`, failures are retried up to 3 times with jittered backoff. */
  async function deliver(hook: Row, event: string, data: unknown, retry: boolean): Promise<DeliveryResult> {
    const body = JSON.stringify({ event, occurredAt: now().toISOString(), user: await owner(hook.userId), data });
    const res = await attempt(hook, event, body);
    if (!res.ok && retry) await scheduleRetry(hook.id, event, body, 0);
    return res;
  }

  async function emit(userId: string, event: string, data: unknown) {
    if (!(await flags.getFeatures()).webhooks?.enabled) return;
    const rows = await db.select().from(webhooks).where(and(eq(webhooks.userId, userId), eq(webhooks.enabled, true)));
    await Promise.all(rows.filter((r) => r.events.includes(event)).map((r) => deliver(r, event, data, true)));
  }

  /** Sends the daily digest to every webhook whose local time has reached `dailyAt`. */
  async function tick(at: Date = now()) {
    if (!(await flags.getFeatures()).webhooks?.enabled) return;
    const rows = await db.select().from(webhooks).where(eq(webhooks.enabled, true));
    for (const r of rows) {
      if (!r.events.includes("mealplan.today")) continue;
      const { due, date } = digestDue(at, r);
      if (!due) continue;
      // Claim today's digest atomically so overlapping runs send it once.
      const claimed = await queryRows(db, sql`UPDATE webhooks SET last_digest_on = ${date} WHERE id = ${r.id} AND last_digest_on IS DISTINCT FROM ${date} RETURNING id`);
      if (!claimed.length) continue;
      const entries = await listEntries(db, r.userId, date, date);
      const slim = entries.map((e) => ({
        mealType: e.mealType,
        title: e.title,
        recipe: e.recipe ? { name: e.recipe.name, slug: e.recipe.slug } : null,
      }));
      await deliver(r, "mealplan.today", { date, entries: slim }, true);
    }
  }

  const dispatcher = {
    emit: (hh: string, event: string, data: unknown) => void emit(hh, event, data).catch(() => {}),
    emitAndWait: emit,
    tick,
    runRetries,
    start() {
      scheduler.every(DIGEST_JOB, 60_000);
      scheduler.every(RETRY_JOB, 60_000);
    },
    stop() {
      scheduler.stop();
    },
    async sendTest(userId: string, id: string) {
      const hook = await find(db, userId, id);
      return deliver(hook, "ping", { message: "This is a test from Meally." }, false);
    },
  };
  registerWebhookEmitter(db, dispatcher.emit);
  return dispatcher;
}
export type Dispatcher = ReturnType<typeof createDispatcher>;
