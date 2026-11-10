import { Hono } from "hono";
import { FEATURES, type FeatureKey } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";

export const featureRoutes = new Hono<AppEnv>().get("/", async (c) => {
  const resolved = await c.get("flags").getFeatures();
  const features = {} as Record<FeatureKey, (typeof resolved)[FeatureKey] & { label: string; description: string }>;
  for (const f of FEATURES) features[f.key] = { ...resolved[f.key], label: f.label, description: f.description };
  return c.json({ features });
});
