import { z } from "zod";

export const tokenScopes = ["read", "write"] as const;
export type TokenScope = (typeof tokenScopes)[number];

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(tokenScopes),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  scope: TokenScope;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}
