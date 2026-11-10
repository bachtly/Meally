import type { SessionUser, SignupMode } from "@meally/shared";
import type { Db } from "../db/index.js";
import type { FlagsService } from "../features/features/service.js";
import type { Fetcher } from "../features/import-url/fetch.js";
import type { RateLimiter } from "./rate-limit.js";

export interface AuthSettings {
  /** Set when MEALLY_SIGNUP_MODE locks the mode. */
  lockedSignupMode: SignupMode | null;
  secureCookies: boolean;
  baseOrigin: string;
  trustProxy: boolean;
  /** log2 of the scrypt cost parameter N. */
  scryptLogN: number;
  loginLimiter: RateLimiter;
  registerLimiter: RateLimiter;
  inviteLimiter: RateLimiter;
}

/** Hono variables set by app-level middleware. */
export type AppEnv = {
  Variables: {
    db: Db;
    dataDir: string;
    env: Record<string, string | undefined>;
    flags: FlagsService;
    auth: AuthSettings;
    fetcher: Fetcher;
    importLimiter: RateLimiter;
    shareLimiter: RateLimiter;
    user: SessionUser;
    householdId: string;
  };
};
