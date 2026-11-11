import { useCallback, useEffect, useState } from "react";

export interface Checks {
  ingredients: number[];
  steps: number[];
}
const empty: Checks = { ingredients: [], steps: [] };
const key = (slug: string) => `meally:checks:${slug}`;

function load(slug: string): Checks {
  try {
    const raw = JSON.parse(localStorage.getItem(key(slug)) ?? "null") as Partial<Checks> | null;
    return { ingredients: raw?.ingredients ?? [], steps: raw?.steps ?? [] };
  } catch {
    return empty;
  }
}

/** Ticked ingredients and steps for one recipe, saved in localStorage (which may be unavailable). */
export function useChecks(slug: string) {
  const [checks, setChecks] = useState<Checks>(() => load(slug));
  useEffect(() => setChecks(load(slug)), [slug]);

  const save = useCallback(
    (next: Checks) => {
      setChecks(next);
      try {
        if (next.ingredients.length || next.steps.length) localStorage.setItem(key(slug), JSON.stringify(next));
        else localStorage.removeItem(key(slug));
      } catch {
        /* storage blocked: keep in memory only */
      }
    },
    [slug],
  );

  const toggle = (kind: keyof Checks, i: number) =>
    save({ ...checks, [kind]: checks[kind].includes(i) ? checks[kind].filter((x) => x !== i) : [...checks[kind], i] });
  return { checks, toggle, reset: () => save(empty), any: checks.ingredients.length + checks.steps.length > 0 };
}
