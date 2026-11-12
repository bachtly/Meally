import { describe, expect, it } from "vitest";
import { resolveFeatures } from "../features.js";
import { friendInviteTokenSchema } from "./friends.js";
import { pushSubscribeSchema } from "./push.js";
import { reactionKeys, reactionParamSchema, snapCreateSchema, snapListQuerySchema, snapPatchSchema } from "./snaps.js";

describe("snap schemas", () => {
  it("requires clientId and trims fields", () => {
    expect(snapCreateSchema.safeParse({}).success).toBe(false);
    const r = snapCreateSchema.parse({ clientId: "c1", caption: "  hi  " });
    expect(r.caption).toBe("hi");
  });
  it("enforces length limits", () => {
    expect(snapCreateSchema.safeParse({ clientId: "c", caption: "a".repeat(2000) }).success).toBe(true);
    expect(snapCreateSchema.safeParse({ clientId: "c", caption: "a".repeat(2001) }).success).toBe(false);
    expect(snapCreateSchema.safeParse({ clientId: "c", dishName: "a".repeat(121) }).success).toBe(false);
    expect(snapCreateSchema.safeParse({ clientId: "c", place: "a".repeat(121) }).success).toBe(false);
  });
  it("patch accepts only recipeId, and null clears it", () => {
    expect(snapPatchSchema.safeParse({}).success).toBe(false);
    expect(snapPatchSchema.safeParse({ recipeId: null }).success).toBe(true);
    expect(snapPatchSchema.safeParse({ recipeId: "r1", caption: "x" }).success).toBe(false);
  });
  it("limits the feed page size", () => {
    expect(snapListQuerySchema.parse({}).limit).toBe(20);
    expect(snapListQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });
  it("accepts only fixed reaction keys", () => {
    expect(reactionKeys).toHaveLength(6);
    expect(reactionParamSchema.safeParse({ emoji: "heart" }).success).toBe(true);
    expect(reactionParamSchema.safeParse({ emoji: "💩" }).success).toBe(false);
  });
  it("validates push subscriptions and invite tokens", () => {
    expect(pushSubscribeSchema.safeParse({ endpoint: "https://p.example/x", keys: { p256dh: "a", auth: "b" } }).success).toBe(true);
    expect(pushSubscribeSchema.safeParse({ endpoint: "nope", keys: { p256dh: "a", auth: "b" } }).success).toBe(false);
    expect(friendInviteTokenSchema.safeParse({ token: "" }).success).toBe(false);
  });
});

describe("snap flags", () => {
  it("default on, and push follows snaps", () => {
    const on = resolveFeatures();
    expect(on.snaps.enabled && on.friends.enabled && on.push.enabled).toBe(true);
    const off = resolveFeatures({ overrides: { snaps: false } });
    expect(off.push).toEqual({ enabled: false, locked: false, source: "dependency" });
    expect(off.friends.enabled).toBe(true);
  });
});
