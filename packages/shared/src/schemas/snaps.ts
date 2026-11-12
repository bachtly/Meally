import { z } from "zod";

/** The fixed set of reaction keys. No counts are shown anywhere. */
export const reactionKeys = ["heart", "yum", "fire", "clap", "wow", "laugh"] as const;
export type ReactionKey = (typeof reactionKeys)[number];
export const reactionKeySchema = z.enum(reactionKeys);

export const SNAP_CAPTION_MAX = 2000;
export const SNAP_DISH_NAME_MAX = 120;
export const SNAP_PLACE_MAX = 120;

const caption = z.string().trim().max(SNAP_CAPTION_MAX);
const dishName = z.string().trim().max(SNAP_DISH_NAME_MAX);
const place = z.string().trim().max(SNAP_PLACE_MAX);

/** Text fields of `POST /snaps` (the image parts travel as multipart). */
export const snapCreateSchema = z.object({
  clientId: z.string().trim().min(1).max(100),
  caption: caption.optional(),
  dishName: dishName.optional(),
  place: place.optional(),
  recipeId: z.string().min(1).max(100).optional(),
});
export type SnapCreate = z.infer<typeof snapCreateSchema>;

/** Only the Linked recipe can change after posting. */
export const snapPatchSchema = z.object({ recipeId: z.string().min(1).max(100).nullable() }).strict();
export type SnapPatch = z.infer<typeof snapPatchSchema>;

export const snapListQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const reactionParamSchema = z.object({ emoji: reactionKeySchema });

export interface SnapReaction {
  userId: string;
  name: string;
  emoji: ReactionKey;
}

export interface Snap {
  id: string;
  author: { id: string; name: string };
  /** 800 px image and 320 px thumbnail. */
  imageUrl: string;
  thumbUrl: string;
  caption: string | null;
  dishName: string | null;
  place: string | null;
  recipe: { slug: string; name: string } | null;
  /** Epoch ms. */
  createdAt: number;
  myReactions: ReactionKey[];
  /** Present only for the author. */
  reactions?: SnapReaction[];
}
export type SnapListResponse = { items: Snap[]; nextCursor: string | null };
