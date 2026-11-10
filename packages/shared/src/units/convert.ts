import { unitByKey, type UnitDef } from "./units.js";

export interface Amount {
  quantity: number | null;
  unit: string | null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/** Units a total may be re-expressed in, smallest first. Others (pint, fl oz, cl, dl, mg) are never chosen. */
const FRIENDLY: Record<string, string[]> = {
  "volume/metric": ["ml", "l"],
  "volume/us": ["tsp", "tbsp", "cup", "quart", "gallon"],
  "mass/metric": ["g", "kg"],
  "mass/us": ["oz", "lb"],
};

/** Two unit keys are convertible when equal, or both are mass, or both are volume. Count-like units only match themselves. */
export function canConvert(from: string | null, to: string | null): boolean {
  if (from === to) return true;
  if (!from || !to) return false;
  const a = unitByKey(from);
  const b = unitByKey(to);
  return !!a && !!b && a.kind === b.kind && a.kind !== "count";
}

/** Convert a quantity between units of the same kind; null when they are not convertible. */
export function convertQuantity(
  quantity: number,
  from: string | null,
  to: string | null,
): number | null {
  if (!canConvert(from, to)) return null;
  if (from === to) return quantity;
  const a = unitByKey(from!) as UnitDef;
  const b = unitByKey(to!) as UnitDef;
  return round((quantity * a.factor) / b.factor);
}

/**
 * Re-express a quantity in the most readable unit of the same system: the largest one in which the value is at least 1
 * (or the smallest unit if none is). Units outside the friendly sets are returned unchanged.
 */
export function friendlyAmount(
  quantity: number,
  unit: string | null,
): { quantity: number; unit: string | null } {
  const def = unit ? unitByKey(unit) : undefined;
  const set = def && FRIENDLY[`${def.kind}/${def.system}`];
  if (!def || !set || !set.includes(def.key))
    return { quantity: round(quantity), unit };
  const base = quantity * def.factor;
  let pick = set[0]!;
  for (const k of set) if (base / unitByKey(k)!.factor >= 0.999) pick = k;
  return { quantity: round(base / unitByKey(pick)!.factor), unit: pick };
}

/**
 * Add two amounts of the same ingredient. The result is in the first amount's system (so an item already on a list
 * keeps its units). Returns null when they cannot be combined: unconvertible units, or only one side has a quantity.
 */
export function mergeQuantities(a: Amount, b: Amount): Amount | null {
  if (a.quantity == null || b.quantity == null) {
    return a.quantity == null && b.quantity == null && a.unit === b.unit
      ? { quantity: null, unit: a.unit }
      : null;
  }
  const bInA = convertQuantity(b.quantity, b.unit, a.unit);
  if (bInA == null) return null;
  return friendlyAmount(a.quantity + bInA, a.unit);
}
