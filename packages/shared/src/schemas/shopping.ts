import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const shoppingListInput = z.object({
  name: z.string().trim().min(1).max(120),
});
export const shoppingItemInput = z.object({
  text: z.string().trim().min(1).max(300),
});
export const shoppingItemPatch = z
  .object({
    checked: z.boolean(),
    text: z.string().trim().min(1).max(300),
    aisle: z.string().max(64).nullable(),
    position: z.number().int().min(0).max(1_000_000),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const addRecipeInput = z.object({
  slug: z.string().min(1).max(200),
  servings: z.number().positive().max(1000).optional(),
});
export const addMealPlanInput = z.object({ from: date, to: date });
export const aisleInput = z.object({
  name: z.string().trim().min(1).max(60),
  color: z
    .string()
    .trim()
    .max(32)
    .nullish()
    .transform((v) => v ?? null),
});
export const aislePatch = aisleInput
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export const aisleOrderInput = z.object({ ids: z.array(z.string()).max(200) });

export interface ShoppingRecipeRef {
  slug: string;
  name: string;
}
export interface ShoppingItem {
  id: string;
  listId: string;
  text: string;
  quantity: number | null;
  unit: string | null;
  food: string | null;
  note: string | null;
  /** Aisle label id, or null. */
  aisle: string | null;
  checked: boolean;
  position: number;
  recipeRefs: ShoppingRecipeRef[];
  updatedAt: string;
}
export interface ShoppingList {
  id: string;
  name: string;
  total: number;
  checked: number;
  createdAt: string;
  updatedAt: string;
}
export interface AisleLabel {
  id: string;
  name: string;
  position: number;
  color: string | null;
}
