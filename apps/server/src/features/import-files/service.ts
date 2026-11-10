import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { recipeInputSchema } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { importJobs, recipes } from "../../db/schema/index.js";
import { ApiError } from "../../lib/errors.js";
import { cleanNames } from "../organizers/service.js";
import { createRecipe, setRecipeImage } from "../recipes/service.js";
import type { Plan } from "./importers.js";

export const MAX_ERRORS = 100;
type Job = typeof importJobs.$inferSelect;

export const jobView = (j: Job) => ({
  id: j.id,
  format: j.format,
  filename: j.filename,
  status: j.status,
  total: j.total,
  imported: j.imported,
  skipped: j.skipped,
  failed: j.failed,
  errors: j.errors,
  createdAt: j.createdAt.getTime(),
  finishedAt: j.finishedAt?.getTime() ?? null,
});

export async function createJob(db: Db, householdId: string, userId: string, format: string, filename: string, total: number) {
  const [job] = await db
    .insert(importJobs)
    .values({ id: randomUUID(), householdId, userId, format, filename: filename.slice(0, 200), status: "queued", total, createdAt: new Date() })
    .returning();
  return job!;
}

export async function getJob(db: Db, householdId: string, id: string) {
  const [j] = await db.select().from(importJobs).where(and(eq(importJobs.id, id), eq(importJobs.householdId, householdId))).limit(1);
  if (!j) throw new ApiError(404, "not_found", "Import not found");
  return j;
}

export async function listJobs(db: Db, householdId: string, limit = 20) {
  return db.select().from(importJobs).where(eq(importJobs.householdId, householdId)).orderBy(desc(importJobs.createdAt)).limit(limit);
}

/** Jobs left running by a previous process can never finish; mark them failed on startup. */
export async function failStaleJobs(db: Db) {
  await db
    .update(importJobs)
    .set({ status: "failed", finishedAt: new Date(), errors: [{ item: "import", message: "Interrupted by a server restart" }] })
    .where(inArray(importJobs.status, ["queued", "running"]));
}

// In-process queue: one import at a time so a big upload cannot starve the server.
let chain: Promise<unknown> = Promise.resolve();
export function enqueue(task: () => Promise<void>): Promise<void> {
  const next = chain.then(task, task);
  chain = next.catch(() => {});
  return next;
}

interface Ctx {
  db: Db;
  dataDir: string;
  householdId: string;
  userId: string;
  org: boolean;
  jobId: string;
  file: string;
  plan: Plan;
}

async function exists(db: Db, householdId: string, name: string, sourceUrl: string | null) {
  const [row] = await db
    .select({ id: recipes.id })
    .from(recipes)
    .where(
      and(
        eq(recipes.householdId, householdId),
        eq(recipes.name, name),
        sourceUrl ? eq(recipes.sourceUrl, sourceUrl) : isNull(recipes.sourceUrl),
      ),
    )
    .limit(1);
  return !!row;
}

export async function runJob(ctx: Ctx) {
  const { db, jobId, plan } = ctx;
  const where = eq(importJobs.id, jobId);
  let total = plan.items.length;
  let imported = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Array<{ item: string; message: string }> = [];
  const fail = (item: string, message: string) => {
    failed++;
    if (errors.length < MAX_ERRORS) errors.push({ item, message });
  };
  const save = (extra: Partial<Job> = {}) => db.update(importJobs).set({ total, imported, skipped, failed, errors, ...extra }).where(where);
  try {
    await save({ status: "running" });
    for (const item of plan.items) {
      try {
        const loaded = await item.load();
        if (!loaded.length) fail(item.label, "No recipe found");
        total += Math.max(0, loaded.length - 1);
        for (const { extracted, image } of loaded) {
          const parsed = recipeInputSchema.safeParse(extracted.recipe);
          if (!parsed.success) {
            fail(item.label, parsed.error.issues[0]?.message ?? "Invalid recipe");
            continue;
          }
          const input = parsed.data;
          if (await exists(db, ctx.householdId, input.name, input.sourceUrl)) {
            skipped++;
            continue;
          }
          if (ctx.org) {
            input.tags = cleanNames(extracted.keywords, 10);
            input.categories = cleanNames(extracted.categories, 10);
          }
          const recipe = await createRecipe(db, ctx.householdId, ctx.userId, input, { org: ctx.org });
          imported++;
          if (image?.length) {
            // A bad photo never fails the recipe.
            try {
              await setRecipeImage(db, ctx.dataDir, ctx.householdId, recipe.slug, image);
            } catch {
              /* keep the recipe without a photo */
            }
          }
        }
      } catch (e) {
        fail(item.label, e instanceof Error ? e.message.slice(0, 300) : "Could not read this item");
      }
      await save();
    }
    await save({ status: "done", finishedAt: new Date() });
  } catch (e) {
    fail("import", e instanceof Error ? e.message.slice(0, 300) : "Import failed");
    await save({ status: "failed", finishedAt: new Date() }).catch(() => {});
  } finally {
    plan.close();
    await fs.rm(ctx.file, { force: true });
  }
}
