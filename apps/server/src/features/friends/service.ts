import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, inArray, or } from "drizzle-orm";
import { DEFAULT_FRIEND_CAP, type Friend, type FriendInvite } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { friendshipInvites, friendships, instanceSettings, users } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FRIEND_CAP_KEY = "friend_cap";
export const MAX_FRIEND_CAP = 100;

type Reader = Pick<Db, "select">;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** The instance's Friend cap: the admin setting, or the default when unset or invalid. */
export async function getFriendCap(db: Reader): Promise<number> {
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, FRIEND_CAP_KEY)).limit(1);
  const n = Number(row?.value);
  return Number.isInteger(n) && n >= 1 ? n : DEFAULT_FRIEND_CAP;
}

const involves = (userId: string) => or(eq(friendships.userAId, userId), eq(friendships.userBId, userId));

async function friendCount(db: Reader, userId: string): Promise<number> {
  const [r] = await db
    .select({ n: count() })
    .from(friendships)
    .where(and(involves(userId), eq(friendships.status, "accepted")));
  return r?.n ?? 0;
}

const pair = (a: string, b: string) => (a < b ? ([a, b] as const) : ([b, a] as const));

const capError = (cap: number) => new ApiError(409, "friend_cap", `You can have at most ${cap} friends`);

export async function createInvite(db: Db, userId: string) {
  const cap = await getFriendCap(db);
  if ((await friendCount(db, userId)) >= cap) throw capError(cap);
  const token = randomBytes(24).toString("base64url");
  const id = randomUUID();
  const now = Date.now();
  await db.insert(friendshipInvites).values({
    id,
    tokenHash: hashInviteToken(token),
    createdBy: userId,
    expiresAt: new Date(now + INVITE_TTL_MS),
    createdAt: new Date(now),
  });
  return { id, token, expiresAt: now + INVITE_TTL_MS };
}

export async function listInvites(db: Db, userId: string): Promise<FriendInvite[]> {
  const rows = await db
    .select()
    .from(friendshipInvites)
    .where(eq(friendshipInvites.createdBy, userId))
    .orderBy(friendshipInvites.createdAt, friendshipInvites.id);
  return rows.map((r) => ({ id: r.id, expiresAt: r.expiresAt.getTime(), usedAt: r.usedAt?.getTime() ?? null }));
}

export async function revokeInvite(db: Db, userId: string, id: string): Promise<void> {
  const gone = await db
    .delete(friendshipInvites)
    .where(and(eq(friendshipInvites.id, id), eq(friendshipInvites.createdBy, userId)))
    .returning({ id: friendshipInvites.id });
  if (!gone.length) throw new ApiError(404, "not_found", "Invite not found");
}

/** The unused, unexpired invite for a token and its inviter's name, or null. Never says why a token is invalid. */
export async function findValidInvite(db: Reader, token: string) {
  const [row] = await db
    .select({ invite: friendshipInvites, inviterName: users.name })
    .from(friendshipInvites)
    .innerJoin(users, eq(users.id, friendshipInvites.createdBy))
    .where(eq(friendshipInvites.tokenHash, hashInviteToken(token)))
    .limit(1);
  if (!row || row.invite.usedAt || row.invite.expiresAt.getTime() <= Date.now()) return null;
  return { id: row.invite.id, createdBy: row.invite.createdBy, inviterName: row.inviterName };
}

export async function previewInvite(db: Reader, token: string) {
  const found = await findValidInvite(db, token);
  if (!found) throw new ApiError(404, "not_found", "Invite not found");
  return { inviter: { name: found.inviterName } };
}

async function friendOf(db: Reader, userId: string, otherId: string): Promise<Friend | null> {
  const [a, b] = pair(userId, otherId);
  const [row] = await db
    .select({ name: users.name, acceptedAt: friendships.acceptedAt, createdAt: friendships.createdAt })
    .from(friendships)
    .innerJoin(users, eq(users.id, otherId))
    .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b), eq(friendships.status, "accepted")))
    .limit(1);
  return row ? { userId: otherId, name: row.name, since: (row.acceptedAt ?? row.createdAt).getTime() } : null;
}

/**
 * Accepting is the redeemer's acceptance: one transaction locks both users (in id order, so two accepts can't
 * deadlock), re-reads the invite, checks the cap for both, and writes an accepted Friendship.
 * A retry by the same user returns the existing Friend with `created: false`.
 */
export async function acceptInvite(db: Db, userId: string, token: string): Promise<{ friend: Friend; created: boolean }> {
  const tokenHash = hashInviteToken(token);
  const [peek] = await db.select().from(friendshipInvites).where(eq(friendshipInvites.tokenHash, tokenHash)).limit(1);
  if (!peek) throw new ApiError(404, "not_found", "Invite not found");
  return db.transaction((tx) => redeemLocked(tx, userId, tokenHash, peek.createdBy, () => new ApiError(404, "not_found", "Invite not found")));
}

/**
 * Sign-up with an invite: runs inside the registration transaction, after the new user row exists. A token that is
 * no longer valid fails the whole sign-up with `invite_required`; a full Friend list fails it with `friend_cap`.
 */
export async function redeemForSignup(tx: Tx, userId: string, token: string): Promise<void> {
  const tokenHash = hashInviteToken(token);
  const gone = () => new ApiError(403, "invite_required", "An invitation is required to sign up");
  const [peek] = await tx.select().from(friendshipInvites).where(eq(friendshipInvites.tokenHash, tokenHash)).limit(1);
  if (!peek) throw gone();
  await redeemLocked(tx, userId, tokenHash, peek.createdBy, gone);
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function redeemLocked(
  tx: Tx,
  userId: string,
  tokenHash: string,
  inviterId: string,
  invalid: () => ApiError,
): Promise<{ friend: Friend; created: boolean }> {
  {
    const ids = [inviterId, userId].sort();
    await tx.select({ id: users.id }).from(users).where(inArray(users.id, ids)).orderBy(users.id).for("update");
    const [inv] = await tx.select().from(friendshipInvites).where(eq(friendshipInvites.tokenHash, tokenHash)).limit(1);
    if (!inv) throw invalid();
    if (inv.usedBy === userId) {
      const existing = await friendOf(tx, userId, inv.createdBy);
      if (existing) return { friend: existing, created: false };
    }
    if (inv.usedAt || inv.expiresAt.getTime() <= Date.now()) throw invalid();
    if (inv.createdBy === userId) throw new ApiError(409, "own_invite", "That is your own invite link");
    if (await friendOf(tx, userId, inv.createdBy)) throw new ApiError(409, "already_friends", "You are already friends");
    const cap = await getFriendCap(tx);
    if ((await friendCount(tx, userId)) >= cap || (await friendCount(tx, inv.createdBy)) >= cap) throw capError(cap);
    const now = new Date();
    const [a, b] = pair(userId, inv.createdBy);
    await tx
      .insert(friendships)
      .values({ userAId: a, userBId: b, status: "accepted", requestedBy: inv.createdBy, createdAt: now, acceptedAt: now })
      .onConflictDoUpdate({ target: [friendships.userAId, friendships.userBId], set: { status: "accepted", acceptedAt: now } });
    await tx.update(friendshipInvites).set({ usedAt: now, usedBy: userId }).where(eq(friendshipInvites.id, inv.id));
    const friend = await friendOf(tx, userId, inv.createdBy);
    return { friend: friend!, created: true };
  }
}

export async function listFriends(db: Db, userId: string): Promise<{ items: Friend[]; cap: number }> {
  const rows = await db
    .select()
    .from(friendships)
    .where(and(involves(userId), eq(friendships.status, "accepted")));
  const otherIds = rows.map((r) => (r.userAId === userId ? r.userBId : r.userAId));
  const names = otherIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, otherIds)) : [];
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const items = rows
    .map((r, i) => ({ userId: otherIds[i]!, name: nameOf.get(otherIds[i]!) ?? "", since: (r.acceptedAt ?? r.createdAt).getTime() }))
    .sort((x, y) => x.name.localeCompare(y.name) || x.userId.localeCompare(y.userId));
  return { items, cap: await getFriendCap(db) };
}

/** A missing Friendship is a 404, the same as any other row that isn't yours. */
export async function removeFriend(db: Db, userId: string, otherId: string): Promise<void> {
  const [a, b] = pair(userId, otherId);
  const gone = await db
    .delete(friendships)
    .where(and(eq(friendships.userAId, a), eq(friendships.userBId, b), eq(friendships.status, "accepted")))
    .returning({ a: friendships.userAId });
  if (!gone.length) throw new ApiError(404, "not_found", "Friend not found");
}
