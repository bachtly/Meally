import { z } from "zod";

export const shareExpiryDays = [1, 7, 30] as const;
export const createShareSchema = z.object({ expiresInDays: z.union([z.literal(1), z.literal(7), z.literal(30), z.null()]).optional() });

export interface ShareLink {
  id: string;
  createdAt: number;
  expiresAt: number | null;
  viewCount: number;
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
