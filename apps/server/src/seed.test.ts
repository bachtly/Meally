import { expect, it } from "vitest";
import { createTestDb } from "./db/testing.js";
import { recipes } from "./db/schema/index.js";
import { SAMPLE_RECIPES, seed } from "./seed.js";

it("seeds once", async () => {
  const { db } = await createTestDb();
  expect((await seed(db)).created).toBe(true);
  expect((await seed(db)).created).toBe(false);
  expect(await db.select().from(recipes)).toHaveLength(SAMPLE_RECIPES.length);
});
