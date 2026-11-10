import { describe, expect, it } from "vitest";
import { FEATURES, FEATURE_KEYS, featureEnvVar, isFeatureKey, resolveFeatures } from "./features.js";

describe("registry", () => {
  it("has unique kebab-case keys and valid dependencies", () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURES.length);
    for (const f of FEATURES) {
      expect(f.key).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (const d of f.dependsOn) expect(isFeatureKey(d)).toBe(true);
    }
  });
  it("builds env var names", () => {
    expect(featureEnvVar("meal-plan")).toBe("MEALLY_FEATURE_MEAL_PLAN");
    expect(featureEnvVar("ai")).toBe("MEALLY_FEATURE_AI");
  });
});

describe("resolveFeatures", () => {
  it("uses defaults", () => {
    const r = resolveFeatures();
    expect(r["meal-plan"]).toEqual({ enabled: true, locked: false, source: "default" });
    expect(r.ai).toEqual({ enabled: false, locked: false, source: "default" });
  });
  it("applies a DB override", () => {
    const r = resolveFeatures({ overrides: { ai: true, "meal-plan": false } });
    expect(r.ai).toEqual({ enabled: true, locked: false, source: "override" });
    expect(r["meal-plan"].enabled).toBe(false);
  });
  it("env lock beats override", () => {
    const r = resolveFeatures({ env: { MEALLY_FEATURE_MEAL_PLAN: "off" }, overrides: { "meal-plan": true } });
    expect(r["meal-plan"]).toEqual({ enabled: false, locked: true, source: "env" });
  });
  it("parses env case-insensitively and ignores junk", () => {
    const r = resolveFeatures({ env: { MEALLY_FEATURE_AI: " ON ", MEALLY_FEATURE_PRINT: "maybe" } });
    expect(r.ai.enabled).toBe(true);
    expect(r.print).toEqual({ enabled: true, locked: false, source: "default" });
  });
  it("turns dependants off", () => {
    const r = resolveFeatures({ overrides: { organizers: false } });
    expect(r.cookbooks).toEqual({ enabled: false, locked: false, source: "dependency" });
  });
  it("dependency beats env on but stays locked", () => {
    const r = resolveFeatures({ env: { MEALLY_FEATURE_COOKBOOKS: "on", MEALLY_FEATURE_ORGANIZERS: "off" } });
    expect(r.cookbooks).toEqual({ enabled: false, locked: true, source: "dependency" });
  });
  it("a disabled dependency disables an enabled dependant", () => {
    const r = resolveFeatures({ overrides: { webhooks: true, "api-tokens": false } });
    expect(r.webhooks.enabled).toBe(false);
  });
  it("ignores unknown override keys", () => {
    expect(Object.keys(resolveFeatures({ overrides: { nope: true } }))).toHaveLength(FEATURES.length);
  });
});
