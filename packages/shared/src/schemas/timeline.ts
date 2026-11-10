import { z } from "zod";

export const timelineKinds = ["made", "comment", "note"] as const;
export type TimelineKind = (typeof timelineKinds)[number];

const text = z.string().trim().max(2000);
export const timelinePostSchema = z
  .object({ kind: z.enum(timelineKinds), text: text.optional(), rating: z.number().int().min(1).max(5).nullable().optional() })
  .refine((v) => v.kind === "made" || (v.text && v.text.length > 0), { message: "Write something first", path: ["text"] });
export const timelinePatchSchema = z
  .object({ text: text.optional(), rating: z.number().int().min(1).max(5).nullable().optional() })
  .refine((v) => v.text !== undefined || v.rating !== undefined, "Send text and/or rating");
export const timelineListQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  text: string | null;
  rating: number | null;
  /** 800 px image and 320 px thumbnail, when a photo is attached. */
  imageUrl: string | null;
  thumbUrl: string | null;
  userId: string | null;
  userName: string;
  recipeSlug: string;
  recipeName: string;
  createdAt: number;
  editedAt: number | null;
  /** True when the caller may edit or delete this event (author, or household owner for delete). */
  canEdit: boolean;
  canDelete: boolean;
}
export type TimelineResponse = { items: TimelineEvent[]; nextCursor: string | null };
