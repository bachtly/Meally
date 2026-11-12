import type { Db } from "../../db/index.js";

export type EmitFn = (userId: string, event: string, data: unknown) => void;

/** One emitter per database, so services only need the `db` they already have. */
const emitters = new WeakMap<object, EmitFn>();

export function registerWebhookEmitter(db: Db, fn: EmitFn) {
  emitters.set(db, fn);
}

/** Fire-and-forget; never throws into the calling service. */
export function emitWebhookEvent(db: Db, userId: string, event: string, data: unknown) {
  try {
    emitters.get(db)?.(userId, event, data);
  } catch {
    /* webhooks must never break a write */
  }
}
