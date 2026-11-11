import type { Events, Unsubscribe } from "../ports/index.js";

/** In-process pub/sub. Channels are plain strings, so callers build them from tenant ids. */
export class MemoryEvents implements Events {
  constructor(readonly supportsStreaming = true) {}
  private subs = new Map<string, Set<(e: unknown) => void>>();

  publish(channel: string, event: unknown): void {
    const set = this.subs.get(channel);
    if (!set) return;
    for (const fn of Array.from(set)) fn(event);
  }

  subscribe(channel: string, cb: (event: unknown) => void): Unsubscribe {
    let set = this.subs.get(channel);
    if (!set) this.subs.set(channel, (set = new Set()));
    const s = set;
    s.add(cb);
    return () => {
      s.delete(cb);
      if (s.size === 0 && this.subs.get(channel) === s) this.subs.delete(channel);
    };
  }

  listenerCount(channel: string): number {
    return this.subs.get(channel)?.size ?? 0;
  }
}
