import { Hono } from "hono";
import { and, isNotNull, lt, or } from "drizzle-orm";
import type { Db } from "../../db/core.js";
import { shareLinks } from "../../db/schema/index.js";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import type { Scheduler } from "../../ports/index.js";

/** Compares without exiting early on the first differing byte (length is not secret). */
export function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Deletes share links that expired or were revoked more than a week ago. Safe to run twice. */
export async function cleanupShares(db: Db, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - 7 * 86_400_000);
  await db
    .delete(shareLinks)
    .where(or(and(isNotNull(shareLinks.expiresAt), lt(shareLinks.expiresAt, cutoff)), and(isNotNull(shareLinks.revokedAt), lt(shareLinks.revokedAt, cutoff))));
}

/**
 * Jobs every platform exposes by name. `import.run` is a no-op here; the Node app replaces it with the
 * file-import worker, so calling it on the edge (where file import is off) is harmless.
 */
export function defineCoreJobs(scheduler: Scheduler, db: Db) {
  if (!scheduler.has("import.run")) scheduler.define("import.run", () => {});
  scheduler.define("shares.cleanup", () => cleanupShares(db));
}

/** `POST /internal/jobs/:name`: called by pg_cron/pg_net with `Authorization: Bearer <MEALLY_JOBS_SECRET>`. */
export const jobRoutes = new Hono<AppEnv>().post("/jobs/:name", async (c) => {
  const secret = c.get("env").MEALLY_JOBS_SECRET;
  const m = /^Bearer (.+)$/.exec(c.req.header("authorization") ?? "");
  // Always compare (against a placeholder when unset) so timing is uniform; an unset secret never matches.
  const equal = safeEqual(m?.[1] ?? "", secret || "\u0000unset");
  if (!equal || !secret || !m) throw new ApiError(401, "unauthorized", "Invalid or missing jobs secret");
  const name = c.req.param("name");
  const scheduler = c.get("platform").scheduler;
  if (!scheduler.has(name)) throw new ApiError(404, "not_found", "Unknown job");
  const started = Date.now();
  await scheduler.runJob(name);
  return c.json({ ok: true, job: name, ms: Date.now() - started });
});
