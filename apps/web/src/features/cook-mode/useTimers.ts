import { useCallback, useEffect, useRef, useState } from "react";

export interface CookTimer {
  id: string;
  label: string;
  endsAt: number;
}
const key = (slug: string) => `meally:timers:${slug}`;

function load(slug: string): CookTimer[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(slug)) ?? "[]") as CookTimer[];
    return Array.isArray(raw) ? raw.filter((t) => typeof t?.endsAt === "number") : [];
  } catch {
    return [];
  }
}

/** Countdown timers stored as end timestamps, so they survive step changes and refreshes. */
export function useTimers(slug: string, onDone: (t: CookTimer) => void) {
  const [timers, setTimers] = useState<CookTimer[]>(() => load(slug));
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(onDone);
  done.current = onDone;
  const live = useRef(timers);

  const persist = useCallback(
    (next: CookTimer[]) => {
      try {
        if (next.length) localStorage.setItem(key(slug), JSON.stringify(next));
        else localStorage.removeItem(key(slug));
      } catch {
        /* storage blocked: timers last until the page closes */
      }
    },
    [slug],
  );

  useEffect(() => {
    live.current = timers;
    if (!timers.length) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const finished = live.current.filter((x) => x.endsAt <= t);
      if (finished.length) {
        const rest = live.current.filter((x) => x.endsAt > t);
        live.current = rest;
        setTimers(rest);
        persist(rest);
        finished.forEach((x) => done.current(x));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timers, persist]);

  const start = useCallback(
    (label: string, seconds: number) => {
      const t = Date.now();
      setNow(t);
      setTimers((s) => {
        const next = [...s, { id: `${t}-${Math.random().toString(36).slice(2, 8)}`, label, endsAt: t + seconds * 1000 }];
        persist(next);
        return next;
      });
    },
    [persist],
  );
  const cancel = (id: string) =>
    setTimers((s) => {
      const next = s.filter((x) => x.id !== id);
      persist(next);
      return next;
    });
  return { timers, now, start, cancel };
}

/** Short beep and vibration; both are best effort. */
export function alarm() {
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    /* unsupported */
  }
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.2;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    /* audio blocked */
  }
}
