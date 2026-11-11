import { eq } from "drizzle-orm";
import { resolveFeatures, type FeatureKey, type ResolvedFeatures } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { featureFlags } from "../../db/schema/index.js";

export interface FlagsService {
  getFeatures(): Promise<ResolvedFeatures>;
  /** `null` clears the override. Env-locked flags still resolve from env. */
  setOverride(key: FeatureKey, enabled: boolean | null): Promise<void>;
}

export function createFlagsService(db: Db, env: Record<string, string | undefined> = process.env): FlagsService {
  let cache: ResolvedFeatures | null = null;
  return {
    async getFeatures() {
      if (!cache) {
        const overrides: Record<string, boolean> = {};
        for (const row of await db.select().from(featureFlags)) overrides[row.key] = row.enabled;
        cache = resolveFeatures({ env, overrides });
      }
      return cache;
    },
    async setOverride(key, enabled) {
      if (enabled === null) await db.delete(featureFlags).where(eq(featureFlags.key, key));
      else {
        const updatedAt = new Date();
        await db
          .insert(featureFlags)
          .values({ key, enabled, updatedAt })
          .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt } });
      }
      cache = null;
    },
  };
}
