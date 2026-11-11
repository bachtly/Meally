import { z } from "zod";

const slugs = z.array(z.string().trim().min(1).max(100)).max(20);

/** A smart cookbook's saved filter: the same parameters as the library. */
export const cookbookFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  tag: slugs.default([]),
  category: slugs.default([]),
  tool: slugs.default([]),
  favourites: z.boolean().default(false),
  minRating: z.number().int().min(1).max(5).optional(),
});
export type CookbookFilter = z.infer<typeof cookbookFilterSchema>;

export const cookbookKinds = ["smart", "manual"] as const;

export const cookbookInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullish(),
  kind: z.enum(cookbookKinds),
  /** Only used by smart cookbooks. */
  filter: cookbookFilterSchema.optional(),
  /** Recipe slug to use as the cover, or null for the automatic one. */
  coverRecipe: z.string().trim().max(100).nullish(),
});
export type CookbookInput = z.infer<typeof cookbookInputSchema>;

/** Updates cannot change the kind. */
export const cookbookPatchSchema = cookbookInputSchema.omit({ kind: true }).partial();

export type Cookbook = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: (typeof cookbookKinds)[number];
  filter: CookbookFilter | null;
  coverRecipe: string | null;
  /** Up to 4 image URLs; the first is the cover. */
  covers: string[];
  /** Recipe count; for smart cookbooks capped at 100 (`countCapped`). */
  count: number;
  countCapped: boolean;
};
