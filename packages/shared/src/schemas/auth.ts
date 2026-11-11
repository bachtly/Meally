import { z } from "zod";

export const signupModes = ["open", "invite", "closed"] as const;
export type SignupMode = (typeof signupModes)[number];

const email = z.string().trim().toLowerCase().pipe(z.string().email("Enter a valid email address").max(254));
const name = z.string().trim().min(1, "Enter your name").max(80);
/** The max length bounds the cost of hashing. */
const password = z.string().min(8, "Use at least 8 characters").max(200, "Use at most 200 characters");

export const setupSchema = z.object({
  email,
  name,
  password,
  householdName: z.string().trim().min(1).max(80).optional(),
});
export type SetupInput = z.infer<typeof setupSchema>;

export const registerSchema = z.object({ email, name, password, inviteToken: z.string().max(200).optional() });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password").max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const userRoles = ["admin", "member"] as const;
export type UserRole = (typeof userRoles)[number];

export const householdRoles = ["owner", "member"] as const;
export type HouseholdRole = (typeof householdRoles)[number];

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  householdId: string;
  householdRole: HouseholdRole;
}
export interface SessionHousehold {
  id: string;
  name: string;
}
export interface MeResponse {
  user: SessionUser;
  household: SessionHousehold;
}
export interface AuthStatus {
  needsSetup: boolean;
  signupMode: SignupMode;
}

export const householdPatchSchema = z.object({ name: z.string().trim().min(1, "Enter a name").max(80) });
export const inviteInputSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254).optional(),
  role: z.enum(householdRoles).default("member"),
});
export const memberPatchSchema = z.object({ role: z.enum(householdRoles) });
export const joinSchema = z.object({ token: z.string().min(1).max(200) });

export interface HouseholdMember {
  id: string;
  name: string;
  email: string;
  role: HouseholdRole;
  you: boolean;
}
export interface HouseholdInvite {
  id: string;
  email: string | null;
  role: HouseholdRole;
  expiresAt: string;
  createdAt: string;
}
export interface HouseholdDetail {
  household: SessionHousehold;
  members: HouseholdMember[];
}
export interface InviteLookup {
  householdName: string;
  valid: boolean;
}
