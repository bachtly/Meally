import { formatQuantity } from "../ingredients/format.js";
import { FRIENDLY } from "./convert.js";
import { unitByKey, type UnitDef } from "./units.js";

/** The fields of an ingredient that scaling and conversion read. Recipe and parsed ingredients both fit. */
export interface ScalableIngredient {
  quantity: number | null;
  quantityMax?: number | null;
  unit: string | null;
  food: string | null;
  note: string | null;
  raw: string;
}

export type UnitChoice = "original" | "metric" | "us";

const round = (n: number, d = 3) => {
  const m = 10 ** d;
  return Math.round(n * m) / m;
};

const FRACTION_STEPS = [0, 1 / 8, 1 / 4, 1 / 3, 3 / 8, 1 / 2, 5 / 8, 2 / 3, 3 / 4, 7 / 8, 1];

/** Snap to the nearest cooking fraction (eighths and thirds), never below 1/8. */
function snap(n: number): number {
  const whole = Math.floor(n);
  const frac = n - whole;
  let best = FRACTION_STEPS[0]!;
  for (const s of FRACTION_STEPS) if (Math.abs(s - frac) < Math.abs(best - frac)) best = s;
  const out = whole + best;
  return out === 0 ? 1 / 8 : out;
}

/** Round a converted quantity the way a cook would measure it. */
function tidy(n: number, unit: string): number {
  switch (unit) {
    case "ml":
      return n < 20 ? round(Math.round(n * 2) / 2) : n < 50 ? Math.round(n) : Math.round(n / 5) * 5;
    case "g":
      return n < 50 ? Math.round(n) : Math.round(n / 5) * 5;
    case "l":
    case "kg":
      return round(n, 2);
    default:
      return snap(n);
  }
}

/** A cup is used from a quarter cup up (1/2 cup, not 8 tbsp); every other unit from 1. */
const MIN_FOR: Record<string, number> = { cup: 0.25 };

function pickUnit(set: string[], baseMax: number): string {
  let pick = set[0]!;
  for (const k of set) if (baseMax / unitByKey(k)!.factor >= (MIN_FOR[k] ?? 1) - 0.001) pick = k;
  return pick;
}

/**
 * Multiply by `factor` and optionally move to another unit system. Count units, unknown units and units without a
 * friendly equivalent keep their unit and only have the quantity scaled.
 */
function rescale(ing: ScalableIngredient, factor: number, system: UnitChoice) {
  const q = ing.quantity! * factor;
  const qMax = ing.quantityMax != null ? ing.quantityMax * factor : null;
  const keep = { quantity: round(q), quantityMax: qMax == null ? null : round(qMax), unit: ing.unit };
  const def: UnitDef | undefined = ing.unit ? unitByKey(ing.unit) : undefined;
  if (!def || def.kind === "count") return keep;

  const target = system === "original" ? def.system : system;
  const set = FRIENDLY[`${def.kind}/${target}`];
  if (!set) return keep;
  const crossing = target !== def.system;
  if (!crossing && !set.includes(def.key)) return keep;

  const base = q * def.factor;
  const baseMax = qMax == null ? null : qMax * def.factor;
  const unit = pickUnit(set, baseMax ?? base);
  const f = unitByKey(unit)!.factor;
  const conv = (b: number) => (crossing ? tidy(b / f, unit) : round(b / f));
  return { quantity: conv(base), quantityMax: baseMax == null ? null : conv(baseMax), unit };
}

function label(unit: string, quantity: number): string {
  const def = unitByKey(unit);
  if (!def) return unit;
  if (quantity > 1) return def.plural;
  return unit === "fl-oz" ? "fl oz" : unit;
}

function fmtNumber(n: number, unit: string | null): string {
  const def = unit ? unitByKey(unit) : undefined;
  return def?.system === "metric" ? String(round(n, 2)) : formatQuantity(n);
}

/** Render an ingredient as a display line. Lines without a quantity or food keep their original text. */
export function formatIngredient(ing: ScalableIngredient): string {
  if (ing.quantity == null || !ing.food) return ing.raw;
  const hi = ing.quantityMax != null && ing.quantityMax > ing.quantity ? ing.quantityMax : null;
  let qty = fmtNumber(ing.quantity, ing.unit);
  if (hi != null) qty += `–${fmtNumber(hi, ing.unit)}`;
  const parts = [qty];
  if (ing.unit) parts.push(label(ing.unit, hi ?? ing.quantity));
  parts.push(ing.food);
  const line = parts.join(" ");
  return ing.note ? `${line}, ${ing.note}` : line;
}

function apply<T extends ScalableIngredient>(ing: T, factor: number, system: UnitChoice): T {
  if (ing.quantity == null || !ing.food || (factor === 1 && system === "original")) return ing;
  const next = { ...ing, ...rescale(ing, factor, system) };
  return { ...next, raw: formatIngredient(next) };
}

/** Scale by `factor`; ranges scale both ends; units tidy within their own system (48 tsp -> 1 cup). */
export function scaleIngredient<T extends ScalableIngredient>(ing: T, factor: number): T {
  return apply(ing, factor, "original");
}

/** Express in metric or US units, choosing friendly ones; `original` returns the input unchanged. */
export function convertIngredient<T extends ScalableIngredient>(ing: T, system: UnitChoice): T {
  return apply(ing, 1, system);
}

/** Scale and convert in one step, so rounding happens once. */
export function adjustIngredient<T extends ScalableIngredient>(ing: T, factor: number, system: UnitChoice): T {
  return apply(ing, factor, system);
}
