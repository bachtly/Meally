import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestDb } from "./testing.js";
import { friendships, images, pushDeliveries, pushSubscriptions, reactions, recipes, snaps, users } from "./schema/index.js";

let h: ReturnType<typeof openTestDb>;
const now = new Date();

async function user(id: string) {
  await h.db.insert(users).values({ id, email: `${id}@x.test`, name: id, passwordHash: "x", role: "member", createdAt: now });
}
async function snap(id: string, userId: string, clientId = id, imageId = `img-${id}`) {
  await h.db.insert(images).values({ id: imageId, userId, createdAt: now });
  await h.db.insert(snaps).values({ id, userId, imageId, clientId, createdAt: now });
}

beforeEach(async () => {
  h = openTestDb();
  await h.ready;
  await user("a");
  await user("b");
});

describe("snap tables", () => {
  it("dedupes (user, clientId) but not across users", async () => {
    await snap("s1", "a", "c1");
    await expect(snap("s2", "a", "c1")).rejects.toThrow();
    await snap("s3", "b", "c1");
  });

  it("keeps a reaction row after removal so the notify marker survives", async () => {
    await snap("s1", "a");
    const key = { snapId: "s1", userId: "b", emoji: "heart" };
    await h.db.insert(reactions).values({ ...key, createdAt: now });
    await expect(h.db.insert(reactions).values({ ...key, createdAt: now })).rejects.toThrow();
    await h.db.update(reactions).set({ removedAt: now }).where(and(eq(reactions.snapId, "s1"), eq(reactions.userId, "b")));
    const rows = await h.db.select().from(reactions);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.removedAt).not.toBeNull();
  });

  it("sets recipe_id null when the recipe is deleted and cascades reactions with the snap", async () => {
    await h.db.insert(recipes).values({ id: "r1", userId: "a", slug: "r", name: "R", createdAt: now, updatedAt: now } as never);
    await snap("s1", "a");
    await h.db.update(snaps).set({ recipeId: "r1" }).where(eq(snaps.id, "s1"));
    await h.db.insert(reactions).values({ snapId: "s1", userId: "b", emoji: "yum", createdAt: now });
    await h.db.delete(recipes).where(eq(recipes.id, "r1"));
    expect((await h.db.select().from(snaps))[0]!.recipeId).toBeNull();
    await h.db.delete(snaps).where(eq(snaps.id, "s1"));
    expect(await h.db.select().from(reactions)).toHaveLength(0);
  });
});

describe("friendships", () => {
  const base = { requestedBy: "a", createdAt: now };
  it("accepts an ordered pair, defaults to pending, rejects reversed and duplicate pairs", async () => {
    await h.db.insert(friendships).values({ userAId: "a", userBId: "b", ...base });
    expect((await h.db.select().from(friendships))[0]!.status).toBe("pending");
    await expect(h.db.insert(friendships).values({ userAId: "b", userBId: "a", ...base })).rejects.toThrow();
    await expect(h.db.insert(friendships).values({ userAId: "a", userBId: "b", ...base })).rejects.toThrow();
  });
  it("rejects a requester outside the pair", async () => {
    await user("c");
    await expect(h.db.insert(friendships).values({ userAId: "a", userBId: "b", requestedBy: "c", createdAt: now })).rejects.toThrow();
  });
});

describe("push tables", () => {
  it("has one subscription per endpoint and cascades deliveries", async () => {
    const sub = { userId: "a", endpoint: "https://p/1", p256dh: "k", auth: "s", createdAt: now };
    await h.db.insert(pushSubscriptions).values({ id: "p1", ...sub });
    await expect(h.db.insert(pushSubscriptions).values({ id: "p2", ...sub })).rejects.toThrow();
    await h.db.insert(pushDeliveries).values({ id: "d1", subscriptionId: "p1", payload: { type: "snap" }, nextAt: now });
    await h.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, "p1"));
    expect(await h.db.select().from(pushDeliveries)).toHaveLength(0);
  });
});
