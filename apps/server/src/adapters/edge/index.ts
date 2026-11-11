import { ApiError } from "../../lib/errors.js";
import type { ImageStore, Platform, Scheduler } from "../../ports/index.js";
import { DEFAULT_PBKDF2_ITERATIONS } from "../../features/auth/pbkdf2.js";
import { MemoryEvents } from "../memory-events.js";
import { createHasher } from "../hasher.js";

/** Placeholder until the object-storage adapter exists: every call says images are not configured. */
export function createUnconfiguredImageStore(): ImageStore {
  const fail = (): never => {
    throw new ApiError(501, "not_configured", "Image storage is not configured on this deployment");
  };
  return { putOriginal: async () => fail(), put: async () => fail(), get: async () => fail(), delete: async () => fail(), urlFor: async () => fail() };
}

/** No timers on the edge: jobs are registered, and only run when something (a cron route) calls `runJob`. */
export function createEdgeScheduler(): Scheduler {
  const handlers = new Map<string, (payload?: unknown) => void | Promise<void>>();
  return {
    define: (name, handler) => void handlers.set(name, handler),
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

export function createEdgePlatform(opts: { pbkdf2Iterations?: number } = {}): Platform {
  return {
    name: "edge",
    images: createUnconfiguredImageStore(),
    /** Isolates do not share memory, so streaming (SSE) is off. */
    events: new MemoryEvents(false),
    scheduler: createEdgeScheduler(),
    hasher: createHasher({ kind: "pbkdf2", iterations: opts.pbkdf2Iterations ?? DEFAULT_PBKDF2_ITERATIONS }),
  };
}
