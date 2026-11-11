import type { Db } from "../db/index.js";
import type { FlagsService } from "../features/features/service.js";

/** Hono variables set by app-level middleware. */
export type AppEnv = { Variables: { db: Db; flags: FlagsService } };
