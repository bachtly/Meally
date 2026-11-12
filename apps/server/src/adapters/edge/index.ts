import { ApiError } from "../../lib/errors.js";
import type { ImageStore, Platform, Scheduler } from "../../ports/index.js";
import { DEFAULT_PBKDF2_ITERATIONS } from "../../features/auth/pbkdf2.js";
import { createSupabaseImageStore } from "../supabase/images.js";
import { MemoryEvents } from "../memory-events.js";
import { createHasher } from "../hasher.js";

/** Placeholder until the object-storage adapter exists: every call says images are not configured. */
export function createUnconfiguredImageStore(): ImageStore {
  const fail = (): never => {
    throw new ApiError(501, "not_configured", "Image storage is not configured on this deployment");
  };
  return { acceptsPresized: false, putOriginal: async () => fail(), putSized: async () => fail(), put: async () => fail(), get: async () => fail(), delete: async () => fail(), moveOwner: async () => fail() };
}

/** No timers on the edge: jobs are registered, and only run when something (a cron route) calls `runJob`. */
export function createEdgeScheduler(): Scheduler {
  const handlers = new Map<string, (payload?: unknown) => void | Promise<void>>();
  return {
    define: (name, handler) => void handlers.set(name, handler),
    has: (name) => handlers.has(name),
    every: () => {},
    daily: () => {},
    runAfter: () => {},
    async runJob(name, payload) {
      const h = handlers.get(name);
      if (!h) throw new Error(`Unknown job: ${name}`);
      await h(payload);
    },
    stop: () => {},
  };
}

export interface EdgePlatformOptions {
  pbkdf2Iterations?: number;
  /** Process environment (Deno.env); `MEALLY_PLATFORM=supabase` turns on Supabase Storage for images. */
  env?: Record<string, string | undefined>;
  /** fetch used for Storage calls; tests replace it. */
  fetch?: typeof fetch;
}

/**
 * The edge platform: Supabase Storage images (when configured), a scheduler that only runs jobs on request
 * (pg_cron calls `/internal/jobs/:name`), polling instead of streaming, and PBKDF2 hashing.
 */
export function createEdgePlatform(opts: EdgePlatformOptions = {}): Platform {
  const env = opts.env ?? {};
  const supabase = env.MEALLY_PLATFORM === "supabase";
  if (supabase && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)) throw new Error("MEALLY_PLATFORM=supabase needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  return {
    name: supabase ? "supabase" : "edge",
    images: supabase
      ? createSupabaseImageStore({ url: env.SUPABASE_URL!, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY!, ...(opts.fetch ? { fetch: opts.fetch } : {}) })
      : createUnconfiguredImageStore(),
    /** Isolates do not share memory, so streaming (SSE) is off; clients poll with ETags. */
    events: new MemoryEvents(false),
    scheduler: createEdgeScheduler(),
    hasher: createHasher({ kind: "pbkdf2", iterations: opts.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS }),
  };
}
