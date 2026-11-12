import { eq } from "drizzle-orm";
import type { Db } from "../db/core.js";
import { imageMoves } from "../db/schema/index.js";
import type { ImageStore } from "../ports/index.js";

/**
 * Finishes the rekey (ADR 0003): moves each former household's image folder to its user's folder.
 * Rows come from the `0005_rekey_users` migration. A row is deleted only after its files moved, and the store
 * copies before it deletes, so a crash at any point is safe to rerun. Returns the files and folders handled.
 */
export async function moveLegacyImages(db: Db, images: ImageStore): Promise<{ folders: number; files: number }> {
  const rows = await db.select().from(imageMoves);
  let files = 0;
  for (const row of rows) {
    files += await images.moveOwner(row.householdId, row.userId);
    await db.delete(imageMoves).where(eq(imageMoves.householdId, row.householdId));
  }
  return { folders: rows.length, files };
}
