import type { Db } from "../../db/index.js";
import type { Events } from "../../ports/index.js";
import { MemoryEvents } from "../../adapters/memory-events.js";

export interface ShoppingEvent {
  type: "items" | "list" | "deleted";
  at: number;
}

/** One channel per household and list, so a watcher never sees another household's events. */
export const shoppingChannel = (householdId: string, listId: string) => `shopping:${householdId}:${listId}`;

/** Typed view over the Events port for shopping lists. */
export class ShoppingBus {
  constructor(private events: Events = new MemoryEvents()) {}

  subscribe(householdId: string, listId: string, fn: (e: ShoppingEvent) => void): () => void {
    return this.events.subscribe(shoppingChannel(householdId, listId), (e) => fn(e as ShoppingEvent));
  }

  emit(householdId: string, listId: string, type: ShoppingEvent["type"] = "items") {
    void this.events.publish(shoppingChannel(householdId, listId), { type, at: Date.now() } satisfies ShoppingEvent);
  }

  /** Only meaningful for the in-process adapter; used by tests. */
  listenerCount(householdId: string, listId: string) {
    return (this.events as Partial<MemoryEvents>).listenerCount?.(shoppingChannel(householdId, listId)) ?? 0;
  }
}

// The service functions only receive `db`, so the bus is looked up by database (as webhook emitters are).
const buses = new WeakMap<Db, ShoppingBus>();
export const registerShoppingBus = (db: Db, bus: ShoppingBus) => void buses.set(db, bus);
export const shoppingBusFor = (db: Db): ShoppingBus | undefined => buses.get(db);
