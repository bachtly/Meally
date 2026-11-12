import { z } from "zod";

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
});
export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;

export type PushKeyResponse = { publicKey: string };

/** Payload sent to the service worker. Kept under 2 KB. */
export interface PushPayload {
  type: "snap" | "reaction";
  snapId: string;
  from: string;
  emoji?: string;
}
