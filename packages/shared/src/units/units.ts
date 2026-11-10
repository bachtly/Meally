export type UnitSystem = "metric" | "us" | "none";
export type UnitKind = "mass" | "volume" | "count";

export interface UnitDef {
  /** Canonical key, stable; stored in recipes. */
  key: string;
  /** Spellings accepted by the parser (lowercase, matched case-insensitively). */
  names: string[];
  /** Plural display name. */
  plural: string;
  system: UnitSystem;
  kind: UnitKind;
  /** Multiply by this to get the base unit: millilitres (volume), grams (mass), 1 (count). */
  factor: number;
  /** Names that only match with exactly this casing, e.g. "T" = tablespoon, "t" = teaspoon. */
  caseSensitiveNames?: string[];
}

const u = (
  key: string,
  names: string[],
  plural: string,
  system: UnitSystem,
  kind: UnitKind,
  factor: number,
  caseSensitiveNames?: string[],
): UnitDef => ({ key, names, plural, system, kind, factor, ...(caseSensitiveNames ? { caseSensitiveNames } : {}) });

export const UNITS: UnitDef[] = [
  // volume, metric
  u("ml", ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cc"], "ml", "metric", "volume", 1),
  u("cl", ["cl", "centiliter", "centiliters", "centilitre", "centilitres"], "cl", "metric", "volume", 10),
  u("dl", ["dl", "deciliter", "deciliters", "decilitre", "decilitres"], "dl", "metric", "volume", 100),
  u("l", ["l", "liter", "liters", "litre", "litres"], "l", "metric", "volume", 1000),
  // volume, US
  u("tsp", ["tsp", "tsps", "teaspoon", "teaspoons"], "tsp", "us", "volume", 4.92892159375, ["t"]),
  u("tbsp", ["tbsp", "tbsps", "tbs", "tbl", "tablespoon", "tablespoons"], "tbsp", "us", "volume", 14.78676478125, ["T"]),
  u("fl-oz", ["fl oz", "floz", "fluid ounce", "fluid ounces"], "fl oz", "us", "volume", 29.5735295625),
  u("cup", ["cup", "cups", "c"], "cups", "us", "volume", 236.5882365),
  u("pint", ["pint", "pints", "pt"], "pints", "us", "volume", 473.176473),
  u("quart", ["quart", "quarts", "qt"], "quarts", "us", "volume", 946.352946),
  u("gallon", ["gallon", "gallons", "gal"], "gallons", "us", "volume", 3785.411784),
  // mass, metric
  u("mg", ["mg", "milligram", "milligrams"], "mg", "metric", "mass", 0.001),
  u("g", ["g", "gr", "gram", "grams", "gramme", "grammes"], "g", "metric", "mass", 1),
  u("kg", ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes"], "kg", "metric", "mass", 1000),
  // mass, US
  u("oz", ["oz", "ounce", "ounces"], "oz", "us", "mass", 28.349523125),
  u("lb", ["lb", "lbs", "pound", "pounds"], "lb", "us", "mass", 453.59237),
  // count-like (no conversion)
  u("pinch", ["pinch", "pinches"], "pinches", "none", "count", 1),
  u("dash", ["dash", "dashes"], "dashes", "none", "count", 1),
  u("clove", ["clove", "cloves"], "cloves", "none", "count", 1),
  u("can", ["can", "cans", "tin", "tins"], "cans", "none", "count", 1),
  u("jar", ["jar", "jars"], "jars", "none", "count", 1),
  u("bottle", ["bottle", "bottles"], "bottles", "none", "count", 1),
  u("package", ["package", "packages", "pkg", "pkgs", "packet", "packets", "pack", "packs"], "packages", "none", "count", 1),
  u("box", ["box", "boxes"], "boxes", "none", "count", 1),
  u("bag", ["bag", "bags"], "bags", "none", "count", 1),
  u("stick", ["stick", "sticks"], "sticks", "none", "count", 1),
  u("slice", ["slice", "slices"], "slices", "none", "count", 1),
  u("piece", ["piece", "pieces"], "pieces", "none", "count", 1),
  u("bunch", ["bunch", "bunches"], "bunches", "none", "count", 1),
  u("sprig", ["sprig", "sprigs"], "sprigs", "none", "count", 1),
  u("head", ["head", "heads"], "heads", "none", "count", 1),
  u("stalk", ["stalk", "stalks"], "stalks", "none", "count", 1),
  u("handful", ["handful", "handfuls"], "handfuls", "none", "count", 1),
  u("drop", ["drop", "drops"], "drops", "none", "count", 1),
  u("knob", ["knob", "knobs"], "knobs", "none", "count", 1),
  u("fillet", ["fillet", "fillets", "filet", "filets"], "fillets", "none", "count", 1),
];

const lower = new Map<string, UnitDef>();
const exact = new Map<string, UnitDef>();
for (const def of UNITS) {
  for (const n of def.names) lower.set(n.toLowerCase(), def);
  for (const n of def.caseSensitiveNames ?? []) exact.set(n, def);
}

/** Find a unit by any spelling. A trailing period is ignored ("tbsp."). */
export function findUnit(word: string): UnitDef | undefined {
  const w = word.replace(/\.$/, "");
  return exact.get(w) ?? lower.get(w.toLowerCase());
}

export function unitByKey(key: string): UnitDef | undefined {
  return UNITS.find((d) => d.key === key);
}

/** Longest unit name in words, so the parser can try multi-word names like "fl oz". */
export const MAX_UNIT_WORDS = Math.max(...UNITS.flatMap((d) => d.names.map((n) => n.split(/\s+/).length)));
