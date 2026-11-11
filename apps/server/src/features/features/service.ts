import { eq } from "drizzle-orm";
import { resolveFeatures, type FeatureKey, type ResolvedFeatures } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { featureFlags } from "../../db/schema/index.js";

export interface FlagsService {
  getFeatures(): ResolvedFeatures;
  /** `null` clears the override. Env-locked flags still resolve from env. */
  setOverride(key: FeatureKey, enabled: boolean | null): void;
}

export function createFlagsService(db: Db, env: Record<string, string | undefined> = process.env): FlagsService {
  let cache: ResolvedFeatures | null = null;
  return {
    getFeatures() {
      if (!cache) {
        const overrides: Record<string, boolean> = {};
        for (const row of db.select().from(featureFlags).all()) overrides[row.key] = row.enabled;
        cache = resolveFeatures({ env, overrides });
      }
      return cache;
    },
    setOverride(key, enabled) {
      if (enabled === null) db.delete(featureFlags).where(eq(featureFlags.key, key)).run();
      else {
        const updatedAt = new Date();
        db.insert(featureFlags)
          .values({ key, enabled, updatedAt })
          .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedAt } })
          .run();
      }
      cache = null;
    },
  };
}
