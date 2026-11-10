import { z } from "zod";

export const webhookEvents = ["recipe.created", "recipe.updated", "recipe.deleted", "mealplan.today", "shopping.item_checked"] as const;
export type WebhookEvent = (typeof webhookEvents)[number];

const validTz = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const webhookInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  url: z.string().trim().url().max(2000),
  events: z.array(z.enum(webhookEvents)).min(1).transform((e) => [...new Set(e)]),
  enabled: z.boolean().optional(),
  dailyAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 07:00").optional(),
  tz: z.string().max(64).refine(validTz, "Unknown time zone").optional(),
});
export type WebhookInput = z.input<typeof webhookInputSchema>;

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  dailyAt: string;
  tz: string;
  createdAt: number;
  lastStatus: number | null;
  lastDeliveryAt: number | null;
  failureCount: number;
}
export interface WebhookWithSecret extends Webhook {
  secret: string;
}
export interface WebhookDelivery {
  id: string;
  event: string;
  statusCode: number | null;
  ok: boolean;
  error: string | null;
  durationMs: number;
  createdAt: number;
}
