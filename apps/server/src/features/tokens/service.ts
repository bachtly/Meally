import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { ApiToken } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { apiTokens, users } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

export const TOKEN_PREFIX = "mly_";
const DAY = 86_400_000;
/** last_used_at is written at most this often per token. */
export const LAST_USED_EVERY_MS = 60_000;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const toDto = (r: typeof apiTokens.$inferSelect): ApiToken => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scope: r.scopes,
  createdAt: r.createdAt.getTime(),
  lastUsedAt: r.lastUsedAt?.getTime() ?? null,
  expiresAt: r.expiresAt?.getTime() ?? null,
});

export async function createToken(
  db: Db,
  user: { id: string },
  input: { name: string; scope: "read" | "write"; expiresInDays?: number | null },
  now = new Date(),
) {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const row = {
    id: randomUUID(),
    userId: user.id,
    name: input.name,
    tokenHash: hashToken(token),
    prefix: token.slice(0, 8),
    scopes: input.scope,
    createdAt: now,
    lastUsedAt: null,
    expiresAt: input.expiresInDays ? new Date(now.getTime() + input.expiresInDays * DAY) : null,
    revokedAt: null,
  };
  await db.insert(apiTokens).values(row);
  return { token, item: toDto(row) };
}

export async function listTokens(db: Db, userId: string): Promise<ApiToken[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(toDto);
}

export async function revokeToken(db: Db, userId: string, id: string, now = new Date()) {
  const res = await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (res.length === 0) throw new ApiError(404, "not_found", "Token not found");
}

/** Resolves a bearer token to its user; null when unknown, revoked or expired. Touches last_used_at at most once a minute. */
export async function resolveToken(db: Db, token: string, now = new Date()) {
  const [row] = await db
    .select({ t: apiTokens, user: users })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, hashToken(token)))
    .limit(1);
  if (!row || row.t.revokedAt || (row.t.expiresAt && row.t.expiresAt <= now)) return null;
  if (!row.t.lastUsedAt || now.getTime() - row.t.lastUsedAt.getTime() >= LAST_USED_EVERY_MS) {
    await db.update(apiTokens).set({ lastUsedAt: now }).where(eq(apiTokens.id, row.t.id));
  }
  return { id: row.t.id, scope: row.t.scopes, user: row.user };
}
