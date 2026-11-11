import type { MiddlewareHandler } from "hono";
import type { FeatureKey } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";

/** Returns 404 `{error:'feature_disabled'}` when the flag is off. */
export function requireFeature(key: FeatureKey): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!(await c.get("flags").getFeatures())[key].enabled) {
      return c.json({ error: "feature_disabled", message: `The ${key} feature is turned off.` }, 404);
    }
    await next();
  };
}
