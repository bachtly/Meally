import { z } from "zod";

/** Used when the instance has not set `friendCap`. */
export const DEFAULT_FRIEND_CAP = 20;

export interface Friend {
  userId: string;
  name: string;
  /** Epoch ms. */
  since: number;
}
export type FriendListResponse = { items: Friend[]; cap: number };

export interface FriendInvite {
  id: string;
  /** Epoch ms. */
  expiresAt: number;
  usedAt: number | null;
}
export type FriendInviteListResponse = { items: FriendInvite[] };
export interface FriendInviteCreated {
  id: string;
  url: string;
  path: string;
  token: string;
  expiresAt: number;
}
export type FriendInvitePreview = { inviter: { name: string } };

export const friendInviteTokenSchema = z.object({ token: z.string().min(1).max(200) });
