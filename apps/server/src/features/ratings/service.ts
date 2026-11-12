import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { recipeUserData } from "../../db/schema/index.js";

export type Me = { favourite: boolean; rating: number | null };
export type HouseholdRating = { average: number | null; count: number };

export async function getMe(db: Pick<Db, "select">, userId: string, recipeId: string): Promise<Me> {
  const [row] = await db
    .select({ favourite: recipeUserData.favourite, rating: recipeUserData.rating })
    .from(recipeUserData)
    .where(and(eq(recipeUserData.userId, userId), eq(recipeUserData.recipeId, recipeId)));
  return row ?? { favourite: false, rating: null };
}

/** Average and count of the ratings on this recipe (one user's, now), rounded to one decimal. */
export async function householdRating(db: Pick<Db, "select">, recipeId: string): Promise<HouseholdRating> {
  const [row] = await db
    .select({ avg: sql<number | null>`avg(${recipeUserData.rating})`, n: sql<number>`count(${recipeUserData.rating})` })
    .from(recipeUserData)
    .where(eq(recipeUserData.recipeId, recipeId));
  const n = Number(row?.n ?? 0);
  return { average: n && row?.avg != null ? Math.round(Number(row.avg) * 10) / 10 : null, count: n };
}

/** Upserts only the fields given. The recipe must already have been resolved for the caller. */
export async function setMe(db: Db, userId: string, recipeId: string, patch: { favourite?: boolean; rating?: number | null }): Promise<Me> {
  const now = new Date();
  const set = {
    ...(patch.favourite !== undefined ? { favourite: patch.favourite } : {}),
    ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
    updatedAt: now,
  };
  await db
    .insert(recipeUserData)
    .values({ userId, recipeId, favourite: patch.favourite ?? false, rating: patch.rating ?? null, updatedAt: now })
    .onConflictDoUpdate({ target: [recipeUserData.userId, recipeUserData.recipeId], set });
  return getMe(db, userId, recipeId);
}

