import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { households, sessions, users } from "../../db/schema/index.js";

export const SESSION_COOKIE = "meally_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Expiry is only pushed forward when at least a day has passed, to avoid a write per request. */
const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function createSession(db: Db, userId: string, userAgent?: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  db.insert(sessions)
    .values({
      id: hashToken(token),
      userId,
      createdAt: new Date(now),
      expiresAt: new Date(now + SESSION_TTL_MS),
      userAgent: userAgent?.slice(0, 300) ?? null,
    })
    .run();
  return token;
}

export function deleteSession(db: Db, token: string) {
  db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

/** Resolves a cookie token to its user and household; slides the expiry. Null when unknown or expired. */
export function resolveSession(db: Db, token: string) {
  const id = hashToken(token);
  const row = db
    .select({ expiresAt: sessions.expiresAt, user: users, household: households })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(households, eq(households.id, users.householdId))
    .where(eq(sessions.id, id))
    .get();
  if (!row) return null;
  const now = Date.now();
  if (row.expiresAt.getTime() <= now) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return null;
  }
  let refreshed = false;
  if (row.expiresAt.getTime() - now < SESSION_TTL_MS - REFRESH_AFTER_MS) {
    db.update(sessions)
      .set({ expiresAt: new Date(now + SESSION_TTL_MS) })
      .where(eq(sessions.id, id))
      .run();
    refreshed = true;
  }
  return { user: row.user, household: row.household, refreshed };
}
