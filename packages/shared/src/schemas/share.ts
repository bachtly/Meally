import { z } from "zod";

export const shareExpiryDays = [1, 7, 30] as const;
export const SHARE_SET_MAX = 100;
/** A cookbook link shows at most this many recipes. */
export const SHARE_COOKBOOK_MAX = 200;
export const SHARE_NOTE_MAX = 280;
export const SHARE_TITLE_MAX = 120;

const expiry = z.union([z.literal(1), z.literal(7), z.literal(30), z.null()]).optional();
const note = z.string().trim().max(SHARE_NOTE_MAX).nullish();

/** Options every share link takes. `showName` defaults to true (the sharer's name is shown as "Shared by …"). */
export const createShareSchema = z.object({ expiresInDays: expiry, showName: z.boolean().optional(), note });

export const createShareSetSchema = createShareSchema.extend({
  recipeSlugs: z
    .array(z.string().min(1))
    .min(1)
    .max(SHARE_SET_MAX)
    .refine((a) => new Set(a).size === a.length, "Each recipe can be listed once"),
  title: z.string().trim().max(SHARE_TITLE_MAX).nullish(),
});

export type CreateShare = z.infer<typeof createShareSchema>;
export type CreateShareSet = z.infer<typeof createShareSetSchema>;

export type ShareKind = "recipe" | "set" | "cookbook";

/** One recipe's active links (the per-recipe list in the share dialog). */
export interface ShareLink {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  viewCount: number;
}

/** Every active link of the household (the Shared links page). Never the token. */
export interface ShareSummary extends ShareLink {
  kind: ShareKind;
  /** The recipe's or cookbook's current name, or the set's title (null when untitled). */
  title: string | null;
  /** Recipe slug for a recipe link, cookbook slug for a cookbook link, null for a set. */
  targetSlug: string | null;
  /** Recipes in a set link; null otherwise. */
  count: number | null;
  sharedBy: string | null;
  note: string | null;
}

/** The read-only recipe view served at a public link: no ids, no household or user data. */
export interface PublicRecipe {
  name: string;
  description: string | null;
  yieldText: string | null;
  servings: number | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  sourceUrl: string | null;
  notes: string | null;
  imageUrl: string | null;
  ingredients: Array<{ position: number; section: string | null; quantity: number | null; unit: string | null; food: string | null; note: string | null; raw: string }>;
  steps: Array<{ position: number; section: string | null; text: string }>;
  scaling: boolean;
}

/** A card in a set or cookbook link. `slug` addresses the recipe inside the link only. */
export interface PublicShareItem {
  slug: string;
  name: string;
  imageUrl: string | null;
  totalMinutes: number | null;
  servings: number | null;
}

/** The landing payload of `/s/:token`. */
export interface PublicShare {
  kind: ShareKind;
  /** Recipe or cookbook name, or the set's title (null when untitled). */
  title: string | null;
  note: string | null;
  sharedBy: string | null;
  count: number;
  /** Recipe links only. */
  recipe: PublicRecipe | null;
  /** Set and cookbook links; for a recipe link, the one recipe. */
  items: PublicShareItem[];
}

/** Recipes saved per request; the web app saves a larger set in batches and shows progress. */
export const SHARE_SAVE_BATCH = 10;

export const saveShareSchema = z.object({
  /** Slugs as the link lists them (`PublicShareItem.slug`). */
  slugs: z.array(z.string().min(1)).min(1).max(SHARE_SAVE_BATCH),
  /** Also put the copies in a cookbook: a new hand-picked one by name, or one already made by an earlier batch. */
  cookbook: z.union([z.object({ name: z.string().trim().min(1).max(100) }), z.object({ slug: z.string().min(1) })]).optional(),
});
export type SaveShare = z.infer<typeof saveShareSchema>;

/** What the signed-in viewer already has from a link. `saved` maps the link's slug to the viewer's own copy. */
export interface ShareStatus {
  /** The link is the viewer's own: nothing to save, open the recipes directly. */
  ownRecipe: boolean;
  saved: Record<string, string>;
}

export interface SaveShareResult {
  /** Link slug → the viewer's new (or existing) recipe slug. */
  saved: Record<string, string>;
  cookbookSlug: string | null;
}
