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

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}
export interface MeResponse {
  user: SessionUser;
}
export interface AuthStatus {
  needsSetup: boolean;
  signupMode: SignupMode;
}
