import { z } from "zod";

export const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;
export type MealType = (typeof mealTypes)[number];
export const mealTypeSchema = z.enum(mealTypes);

export const MAX_RANGE_DAYS = 62;

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Not a real date");

const title = z.string().trim().min(1).max(120);
const note = z.string().trim().max(500);

export const mealPlanEntryInput = z
  .object({
    date: dateSchema,
    mealType: mealTypeSchema,
    recipeId: z.string().min(1).nullish(),
    title: title.nullish(),
    note: note.nullish(),
  })
  .refine((v) => !!v.recipeId || !!v.title, { message: "Pick a recipe or enter a title", path: ["title"] });
export type MealPlanEntryInput = z.infer<typeof mealPlanEntryInput>;

export const mealPlanEntryPatch = z
  .object({
    date: dateSchema,
    mealType: mealTypeSchema,
    recipeId: z.string().min(1).nullable(),
    title: title.nullable(),
    note: note.nullable(),
    /** Zero-based index within the day and meal type. */
    position: z.number().int().min(0).max(1000),
  })
  .partial();
export type MealPlanEntryPatch = z.infer<typeof mealPlanEntryPatch>;

export const mealPlanRecipeSummary = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  imageUrl: z.string().nullable(),
  totalMinutes: z.number().nullable(),
});
export type MealPlanRecipeSummary = z.infer<typeof mealPlanRecipeSummary>;

export const mealPlanEntry = z.object({
  id: z.string(),
  date: z.string(),
  mealType: mealTypeSchema,
  title: z.string().nullable(),
  note: z.string().nullable(),
  position: z.number(),
  recipe: mealPlanRecipeSummary.nullable(),
});
export type MealPlanEntry = z.infer<typeof mealPlanEntry>;

export const mealPlanRangeResponse = z.object({ items: z.array(mealPlanEntry) });

export const suggestInput = z.object({ date: dateSchema, mealType: mealTypeSchema });
export type SuggestInput = z.infer<typeof suggestInput>;
export const suggestResponse = z.object({ recipe: mealPlanRecipeSummary.nullable() });

const slugList = z.array(z.string().trim().min(1).max(100)).max(20);
export const mealPlanRuleInput = z.object({
  mealType: z.union([mealTypeSchema, z.literal("any")]),
  dayOfWeek: z.number().int().min(0).max(6).nullable().default(null),
  tags: slugList.default([]),
  categories: slugList.default([]),
});
export type MealPlanRuleInput = z.infer<typeof mealPlanRuleInput>;
export const mealPlanRule = mealPlanRuleInput.extend({ id: z.string() });
export type MealPlanRule = z.infer<typeof mealPlanRule>;
