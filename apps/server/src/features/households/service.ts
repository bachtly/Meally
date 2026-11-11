import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { HouseholdInvite, HouseholdMember, HouseholdRole } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { households, invites, users } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

/** Works on the db or inside a transaction. */
type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashInviteToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function getHousehold(db: Db, householdId: string, viewerId: string) {
  const [household] = await db.select().from(households).where(eq(households.id, householdId)).limit(1);
  if (!household) throw new ApiError(404, "not_found", "Household not found");
  const rows = await db.select().from(users).where(eq(users.householdId, householdId)).orderBy(users.createdAt);
  const members: HouseholdMember[] = rows.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.householdRole,
    you: u.id === viewerId,
  }));
  return { household: { id: household.id, name: household.name }, members };
}

export async function renameHousehold(db: Db, householdId: string, name: string) {
  await db.update(households).set({ name }).where(eq(households.id, householdId));
}

export async function createInvite(
  db: Db,
  householdId: string,
  createdBy: string,
  input: { email?: string; role: HouseholdRole },
  ttlMs = INVITE_TTL_MS,
) {
  const token = randomBytes(24).toString("base64url");
  const id = randomUUID();
  const now = Date.now();
  await db.insert(invites).values({
    id,
    householdId,
    tokenHash: hashInviteToken(token),
    email: input.email ?? null,
    role: input.role,
    createdBy,
    expiresAt: new Date(now + ttlMs),
    createdAt: new Date(now),
  });
  return { id, token, expiresAt: new Date(now + ttlMs).toISOString() };
}

export async function listInvites(db: Db, householdId: string): Promise<HouseholdInvite[]> {
  const rows = await db
    .select()
    .from(invites)
    .where(and(eq(invites.householdId, householdId), isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .orderBy(invites.createdAt);
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    role: r.role,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function revokeInvite(db: Db, householdId: string, id: string) {
  const rows = await db
    .delete(invites)
    .where(and(eq(invites.id, id), eq(invites.householdId, householdId)))
    .returning({ id: invites.id });
  if (rows.length === 0) throw new ApiError(404, "not_found", "Invite not found");
}

/** Returns the live invite and its household name, or null when unknown, used or expired. */
export async function findValidInvite(db: Tx, token: string) {
  const [row] = await db
    .select({ invite: invites, householdName: households.name })
    .from(invites)
    .innerJoin(households, eq(households.id, invites.householdId))
    .where(eq(invites.tokenHash, hashInviteToken(token)))
    .limit(1);
  if (!row || row.invite.usedAt || row.invite.expiresAt.getTime() <= Date.now()) return null;
  return row;
}

/** Marks the invite used. Call inside the same transaction as the membership change. */
export async function consumeInvite(tx: Tx, token: string, email: string) {
  const found = await findValidInvite(tx, token);
  if (!found) throw new ApiError(400, "invite_invalid", "This invite link is invalid or has expired");
  if (found.invite.email && found.invite.email !== email.toLowerCase()) {
    throw new ApiError(403, "invite_email_mismatch", "This invite was sent to a different email address");
  }
  const used = await tx
    .update(invites)
    .set({ usedAt: new Date() })
    .where(and(eq(invites.id, found.invite.id), isNull(invites.usedAt)))
    .returning({ id: invites.id });
  if (used.length === 0) throw new ApiError(400, "invite_invalid", "This invite link is invalid or has expired");
  return { householdId: found.invite.householdId, role: found.invite.role };
}

type UserRow = typeof users.$inferSelect;

/** An owner may leave only when another owner stays behind (or they are alone, which just orphans the household). */
async function assertCanLeave(tx: Tx, user: UserRow) {
  if (user.householdRole !== "owner") return;
  const members = await tx.select().from(users).where(eq(users.householdId, user.householdId));
  if (members.length > 1 && !members.some((m) => m.id !== user.id && m.householdRole === "owner")) {
    throw new ApiError(409, "last_owner", "Make another member an owner before leaving");
  }
}

export async function joinWithInvite(db: Db, userId: string, token: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ApiError(404, "not_found", "User not found");
    const target = await findValidInvite(tx, token);
    if (target && target.invite.householdId === user.householdId) {
      throw new ApiError(409, "already_member", "You are already in this household");
    }
    await assertCanLeave(tx, user);
    const { householdId, role } = await consumeInvite(tx, token, user.email);
    await tx.update(users).set({ householdId, householdRole: role }).where(eq(users.id, userId));
  });
}

/** Moves the user into a new empty household that they own. Their old household keeps all its recipes and lists. */
async function moveToFreshHousehold(tx: Tx, user: UserRow) {
  const id = randomUUID();
  await tx.insert(households).values({ id, name: `${user.name}'s household`, createdAt: new Date() });
  await tx.update(users).set({ householdId: id, householdRole: "owner" }).where(eq(users.id, user.id));
}

export async function leaveHousehold(db: Db, userId: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new ApiError(404, "not_found", "User not found");
    const n = (await tx.select({ n: count() }).from(users).where(eq(users.householdId, user.householdId)))[0]?.n ?? 0;
    if (n <= 1) throw new ApiError(409, "only_member", "You are the only member of this household");
    await assertCanLeave(tx, user);
    await moveToFreshHousehold(tx, user);
  });
}

async function memberOf(tx: Tx, householdId: string, userId: string) {
  const [m] = await tx
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.householdId, householdId)))
    .limit(1);
  if (!m) throw new ApiError(404, "not_found", "Member not found");
  return m;
}

export async function removeMember(db: Db, householdId: string, actorId: string, userId: string) {
  if (actorId === userId) throw new ApiError(400, "invalid_request", "Use leave to leave your own household");
  await db.transaction(async (tx) => {
    await moveToFreshHousehold(tx, await memberOf(tx, householdId, userId));
  });
}

export async function setMemberRole(db: Db, householdId: string, userId: string, role: HouseholdRole) {
  await db.transaction(async (tx) => {
    const m = await memberOf(tx, householdId, userId);
    if (m.householdRole === role) return;
    if (role === "member") {
      const owners = await tx
        .select({ n: count() })
        .from(users)
        .where(and(eq(users.householdId, householdId), eq(users.householdRole, "owner")));
      if ((owners[0]?.n ?? 0) <= 1) throw new ApiError(409, "last_owner", "A household needs at least one owner");
    }
    await tx.update(users).set({ householdRole: role }).where(eq(users.id, userId));
  });
}
