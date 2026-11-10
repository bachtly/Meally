import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  text(max)
    .nullish()
    .transform((v) => (v ? v : null));
const minutes = z.number().int().min(0).max(100_000).nullish().transform((v) => v ?? null);

export const ingredientInputSchema = z.object({
  section: optText(120),
  quantity: z.number().min(0).max(1_000_000).nullish().transform((v) => v ?? null),
  unit: optText(60),
  food: optText(200),
  note: optText(300),
  /** The original line as typed or imported; always kept. */
  raw: text(500).min(1, "Ingredient text is required"),
});

export const stepInputSchema = z.object({
  section: optText(120),
  text: text(5000).min(1, "Step text is required"),
});

/** Array order is the position. */
export const recipeInputSchema = z.object({
  name: text(200).min(1, "Name is required"),
  description: optText(5000),
  yieldText: optText(120),
  servings: z.number().positive().max(1000).nullish().transform((v) => v ?? null),
  prepMinutes: minutes,
  cookMinutes: minutes,
  totalMinutes: minutes,
  sourceUrl: z
    .string()
    .trim()
    .max(2000)
    .url("Source must be a valid URL")
    .refine((u) => /^https?:\/\//i.test(u), "Source must be an http(s) URL")
    .nullish()
    .transform((v) => v ?? null),
  notes: optText(10_000),
  ingredients: z.array(ingredientInputSchema).max(200).default([]),
  steps: z.array(stepInputSchema).max(200).default([]),
});
export type RecipeInput = z.input<typeof recipeInputSchema>;
export type RecipeData = z.output<typeof recipeInputSchema>;

export const recipeIngredientSchema = ingredientInputSchema.extend({ position: z.number().int() });
export const recipeStepSchema = stepInputSchema.extend({ position: z.number().int() });

export const recipeSchema = recipeInputSchema.extend({
  id: z.string(),
  slug: z.string(),
  imageUrl: z.string().nullable(),
  ingredients: z.array(recipeIngredientSchema),
  steps: z.array(recipeStepSchema),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Recipe = z.output<typeof recipeSchema>;

export const recipeSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  totalMinutes: z.number().nullable(),
  servings: z.number().nullable(),
  updatedAt: z.number(),
});
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

export const recipeSorts = ["updated", "name", "created"] as const;
export const recipeListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z.enum(recipeSorts).default("updated"),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type RecipeListResponse = { items: RecipeSummary[]; nextCursor: string | null };

export const imageSizes = [320, 800, 1600] as const;
export type ImageSize = (typeof imageSizes)[number];
