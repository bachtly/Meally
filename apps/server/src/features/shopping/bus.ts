export interface ShoppingEvent {
  type: "items" | "list" | "deleted";
  at: number;
}

type Listener = (e: ShoppingEvent) => void;

/** In-process pub/sub keyed by household and list, so a watcher never sees another household's events. */
export class ShoppingBus {
  private subs = new Map<string, Set<Listener>>();
  private key = (householdId: string, listId: string) =>
    `${householdId}:${listId}`;

  subscribe(householdId: string, listId: string, fn: Listener): () => void {
    const k = this.key(householdId, listId);
    let set = this.subs.get(k);
    if (!set) this.subs.set(k, (set = new Set()));
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.subs.delete(k);
    };
  }

  emit(
    householdId: string,
    listId: string,
    type: ShoppingEvent["type"] = "items",
  ) {
    const set = this.subs.get(this.key(householdId, listId));
    if (!set) return;
    for (const fn of [...set]) fn({ type, at: Date.now() });
  }

  listenerCount(householdId: string, listId: string) {
    return this.subs.get(this.key(householdId, listId))?.size ?? 0;
  }
}

export const shoppingBus = new ShoppingBus();
