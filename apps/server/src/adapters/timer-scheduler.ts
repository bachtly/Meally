import type { Scheduler } from "../ports/index.js";

type Handler = (payload?: unknown) => void | Promise<void>;
type Timer = ReturnType<typeof setTimeout>;

/** Timer-based scheduler for a long-running process. Timers are unref'd so they never keep it alive. */
export function createNodeScheduler(log: (msg: string) => void = (m) => console.error(m)): Scheduler {
  const handlers = new Map<string, Handler>();
  const timers = new Set<Timer>();
  const intervals = new Set<ReturnType<typeof setInterval>>();

  const runJob = async (name: string, payload?: unknown) => {
    const h = handlers.get(name);
    if (!h) throw new Error(`Unknown job: ${name}`);
    await h(payload);
  };
  const fire = (name: string, payload?: unknown) =>
    void runJob(name, payload).catch((e) => log(`Job ${name} failed: ${e instanceof Error ? e.message : String(e)}`));
  const timeout = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    timers.add(t);
  };
  const interval = (name: string, ms: number) => {
    const i = setInterval(() => fire(name), ms);
    i.unref?.();
    intervals.add(i);
  };

  function msUntil(time: string, from = new Date()): number {
    const [h = 0, m = 0] = time.split(":").map(Number);
    const next = new Date(from);
    next.setHours(h, m, 0, 0);
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime() - from.getTime();
  }

  return {
    define: (name, handler) => void handlers.set(name, handler),
    has: (name) => handlers.has(name),
    every(name, ms, opts) {
      interval(name, ms);
      if (opts?.firstInMs !== undefined) timeout(() => fire(name), opts.firstInMs);
    },
    daily(name, time) {
      const arm = () =>
        timeout(() => {
          fire(name);
          arm();
        }, msUntil(time));
      arm();
    },
    runAfter(name, delayMs, payload) {
      timeout(() => fire(name, payload), delayMs);
    },
    runJob,
    stop() {
      for (const t of timers) clearTimeout(t);
      for (const i of intervals) clearInterval(i);
      timers.clear();
      intervals.clear();
    },
  };
}
