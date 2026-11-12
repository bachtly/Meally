import { and, eq } from "drizzle-orm";
import type { Db } from "../../db/index.js";
import { recipeUserData } from "../../db/schema/index.js";

export type Me = { favourite: boolean; rating: number | null };

export async function getMe(db: Pick<Db, "select">, userId: string, recipeId: string): Promise<Me> {
  const [row] = await db
    .select({ favourite: recipeUserData.favourite, rating: recipeUserData.rating })
    .from(recipeUserData)
    .where(and(eq(recipeUserData.userId, userId), eq(recipeUserData.recipeId, recipeId)));
  return row ?? { favourite: false, rating: null };
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

