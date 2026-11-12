import type { SessionUser, SignupMode } from "@meally/shared";
import type { Db } from "../db/index.js";
import type { FlagsService } from "../features/features/service.js";
import type { Fetcher } from "../features/import-url/fetch.js";
import type { AiFetch } from "../features/ai/client.js";
import type { Dispatcher } from "../features/webhooks/service.js";
import type { Platform } from "../ports/index.js";
import type { RateLimiter } from "./rate-limit.js";

export interface AuthSettings {
  /** Set when MEALLY_SIGNUP_MODE locks the mode. */
  lockedSignupMode: SignupMode | null;
  secureCookies: boolean;
  baseOrigin: string;
  trustProxy: boolean;
  loginLimiter: RateLimiter;
  registerLimiter: RateLimiter;
  inviteLimiter: RateLimiter;
}

/** Hono variables set by app-level middleware. */
export type AppEnv = {
  Variables: {
    db: Db;
    dataDir: string;
    platform: Platform;
    env: Record<string, string | undefined>;
    flags: FlagsService;
    auth: AuthSettings;
    fetcher: Fetcher;
    webhooks: Dispatcher;
    importLimiter: RateLimiter;
    shareLimiter: RateLimiter;
    tokenLimiter: RateLimiter;
    aiLimiter: RateLimiter;
    aiFetch: AiFetch;
    authVia: "session" | "token";
    user: SessionUser;
    userId: string;
  };
};
