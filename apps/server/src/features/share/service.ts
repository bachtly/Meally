import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { PublicRecipe, ShareLink } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { recipeIngredients, recipes, recipeSteps, shareLinks } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const DAY = 86_400_000;

async function recipeFor(db: Db, householdId: string, slug: string) {
  const [r] = await db.select({ id: recipes.id }).from(recipes).where(and(eq(recipes.householdId, householdId), eq(recipes.slug, slug))).limit(1);
  if (!r) throw new ApiError(404, "not_found", "Recipe not found");
  return r;
}

export async function createShare(db: Db, householdId: string, userId: string, slug: string, days: number | null, now = new Date()) {
  const recipe = await recipeFor(db, householdId, slug);
  const token = randomBytes(32).toString("base64url");
  await db.insert(shareLinks).values({
    id: randomUUID(),
    householdId,
    recipeId: recipe.id,
    tokenHash: hashToken(token),
    createdBy: userId,
    createdAt: now,
    expiresAt: days ? new Date(now.getTime() + days * DAY) : null,
  });
  return token;
}

export async function listShares(db: Db, householdId: string, slug: string, now = new Date()): Promise<ShareLink[]> {
  const recipe = await recipeFor(db, householdId, slug);
  const rows = await db
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.recipeId, recipe.id), eq(shareLinks.householdId, householdId), isNull(shareLinks.revokedAt)))
    .orderBy(asc(shareLinks.createdAt));
  return rows
    .filter((r) => !r.expiresAt || r.expiresAt > now)
    .map((r) => ({ id: r.id, createdAt: r.createdAt.getTime(), expiresAt: r.expiresAt?.getTime() ?? null, viewCount: r.viewCount }));
}

export async function revokeShare(db: Db, householdId: string, id: string, now = new Date()) {
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: now })
    .where(and(eq(shareLinks.id, id), eq(shareLinks.householdId, householdId), isNull(shareLinks.revokedAt)))
    .returning({ id: shareLinks.id });
  if (!rows.length) throw new ApiError(404, "not_found", "Link not found");
}

/** The active link for a token, or null when unknown, revoked or expired. */
export async function findActive(db: Db, token: string, now = new Date()) {
  const [row] = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashToken(token))).limit(1);
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now)) return null;
  return row;
}

export async function publicRecipe(db: Db, token: string, scaling: boolean): Promise<PublicRecipe | null> {
  const link = await findActive(db, token);
  if (!link) return null;
  const [r] = await db.select().from(recipes).where(eq(recipes.id, link.recipeId)).limit(1);
  if (!r) return null;
  await db.update(shareLinks).set({ viewCount: link.viewCount + 1 }).where(eq(shareLinks.id, link.id));
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, r.id)).orderBy(asc(recipeIngredients.position));
  const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, r.id)).orderBy(asc(recipeSteps.position));
  return {
    name: r.name,
    description: r.description,
    yieldText: r.yieldText,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    sourceUrl: r.sourceUrl,
    notes: r.notes,
    imageUrl: r.imageId ? `/api/v1/public/recipes/${token}/image/800` : null,
    ingredients: ings.map(({ position, section, quantity, unit, food, note, raw }) => ({ position, section, quantity, unit, food, note, raw })),
    steps: steps.map(({ position, section, text }) => ({ position, section, text })),
    scaling,
  };
}

/** The image id and owning household for a token's recipe; used by the public image route. */
export async function publicImage(db: Db, token: string) {
  const link = await findActive(db, token);
  if (!link) return null;
  const [r] = await db.select({ imageId: recipes.imageId, householdId: recipes.householdId }).from(recipes).where(eq(recipes.id, link.recipeId)).limit(1);
  return r?.imageId ? { imageId: r.imageId, householdId: r.householdId } : null;
}
