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

export const organizerTypes = ["tags", "categories", "tools"] as const;
export type OrganizerType = (typeof organizerTypes)[number];
export const organizerNameSchema = text(60).min(1, "Name is required");
const organizerNames = z.array(organizerNameSchema).max(30).optional();
export const organizerRefSchema = z.object({ name: z.string(), slug: z.string() });
export type OrganizerRef = z.infer<typeof organizerRefSchema>;

const nutrient = (max: number) => z.number().min(0).max(max).nullish().transform((v) => v ?? null);

/** Per serving. Every value is optional; `source` says where the numbers came from. */
export const nutritionSchema = z.object({
  calories: nutrient(100_000),
  proteinG: nutrient(10_000),
  carbsG: nutrient(10_000),
  fatG: nutrient(10_000),
  saturatedFatG: nutrient(10_000),
  fibreG: nutrient(10_000),
  sugarG: nutrient(10_000),
  sodiumMg: nutrient(1_000_000),
  source: optText(300),
});
export type Nutrition = z.output<typeof nutritionSchema>;
export const nutritionFields = [
  { key: "calories", label: "Calories", unit: "kcal" },
  { key: "fatG", label: "Total fat", unit: "g" },
  { key: "saturatedFatG", label: "Saturated fat", unit: "g" },
  { key: "sodiumMg", label: "Sodium", unit: "mg" },
  { key: "carbsG", label: "Carbohydrate", unit: "g" },
  { key: "fibreG", label: "Fibre", unit: "g" },
  { key: "sugarG", label: "Sugar", unit: "g" },
  { key: "proteinG", label: "Protein", unit: "g" },
] as const satisfies readonly { key: keyof Nutrition; label: string; unit: string }[];

/** True when no value and no source is set. */
export function isNutritionEmpty(n: Nutrition | null | undefined): boolean {
  return !n || (nutritionFields.every((f) => n[f.key] == null) && !n.source);
}

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
  /** Names, upserted case-insensitively. Omitted means "leave as is"; ignored when `organizers` is off. */
  tags: organizerNames,
  categories: organizerNames,
  tools: organizerNames,
  /** Per serving. Omitted means "leave as is"; null clears it. Ignored when `nutrition` is off. */
  nutrition: nutritionSchema.nullish(),
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
  /** Present only when the `organizers` flag is on. */
  tags: z.array(organizerRefSchema).optional(),
  categories: z.array(organizerRefSchema).optional(),
  tools: z.array(organizerRefSchema).optional(),
  /** Present only when the `nutrition` flag is on (null when none is recorded). */
  nutrition: nutritionSchema.nullable().optional(),
  /** Present only when the `ratings` flag is on. */
  me: z.object({ favourite: z.boolean(), rating: z.number().int().min(1).max(5).nullable() }).optional(),
  /** Set when the recipe was saved from a share link: who shared it (null when they hid their name) and when. */
  savedFrom: z.object({ name: z.string().nullable(), at: z.number() }).nullable().optional(),
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
  tags: z.array(organizerRefSchema).optional(),
  categories: z.array(organizerRefSchema).optional(),
  /** The caller's own favourite and rating; present only when the `ratings` flag is on. */
  favourite: z.boolean().optional(),
  rating: z.number().nullable().optional(),
  /** From the timeline; present only when the `timeline` flag is on. */
  lastMadeAt: z.number().nullable().optional(),
  madeCount: z.number().optional(),
  updatedAt: z.number(),
});
export type RecipeSummary = z.infer<typeof recipeSummarySchema>;

const slugList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((x) => x.trim()).filter(Boolean).slice(0, 20)));

export const recipeSorts = ["updated", "name", "created", "rating", "last-made"] as const;
export const recipeListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  sort: z.enum(recipeSorts).default("updated"),
  /** Organiser slugs. Repeat to match any of several (OR within a type; AND across types). */
  tag: slugList,
  category: slugList,
  tool: slugList,
  /** `favourites=1` keeps only the caller's favourites; `minRating` keeps their own ratings of at least n. Both need `ratings`. */
  favourites: z.enum(["1", "true"]).optional().transform((v) => v !== undefined),
  minRating: z.coerce.number().int().min(1).max(5).optional(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});
export type RecipeListResponse = { items: RecipeSummary[]; nextCursor: string | null };

export const imageSizes = [320, 800, 1600] as const;
export type ImageSize = (typeof imageSizes)[number];

/** `PUT /recipes/:slug/me`: omitted fields are left as they are; `rating: null` clears the rating. */
export const recipeMeInputSchema = z
  .object({ favourite: z.boolean().optional(), rating: z.number().int().min(1).max(5).nullable().optional() })
  .refine((v) => v.favourite !== undefined || v.rating !== undefined, "Send favourite and/or rating");
