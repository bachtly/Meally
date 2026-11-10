import type { Nutrition } from "@meally/shared";

const num = (s: string) => parseFloat(s.replace(",", "."));

/**
 * Reads a schema.org amount such as "240 kcal", "12 g", "1,5 g", "500mg" or a bare number, and returns it in
 * `target` units (kcal, g or mg). Returns null when it cannot be read; a bare number is taken as already in `target`.
 */
export function parseAmount(v: unknown, target: "kcal" | "g" | "mg"): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-zA-Zµμ]*)\.?\s*$/.exec(v.replace(/&nbsp;| /g, " "));
  if (!m) return null;
  const n = num(m[1]!);
  const unit = m[2]!.toLowerCase();
  const toG: Record<string, number> = { "": 1, g: 1, gr: 1, gram: 1, grams: 1, mg: 0.001, milligram: 0.001, milligrams: 0.001, mcg: 1e-6, µg: 1e-6, μg: 1e-6, kg: 1000, oz: 28.3495 };
  if (target === "kcal") {
    if (unit === "" || unit === "kcal" || unit === "cal" || unit === "calories" || unit === "calorie") return n;
    if (unit === "kj") return Math.round(n / 4.184);
    return null;
  }
  const f = toG[unit];
  if (f === undefined) return null;
  const grams = n * f;
  // Bare numbers are already in the target unit.
  if (unit === "") return n;
  return target === "mg" ? round(grams * 1000) : round(grams);
}
const round = (x: number) => Math.round(x * 100) / 100;

/** Maps a schema.org NutritionInformation node (per serving by convention) to our shape; null when nothing usable. */
export function nutritionFromSchemaOrg(node: unknown): Partial<Nutrition> | null {
  if (typeof node !== "object" || node === null || Array.isArray(node)) return null;
  const o = node as Record<string, unknown>;
  const out: Partial<Nutrition> = {
    calories: parseAmount(o.calories, "kcal"),
    proteinG: parseAmount(o.proteinContent, "g"),
    carbsG: parseAmount(o.carbohydrateContent, "g"),
    fatG: parseAmount(o.fatContent, "g"),
    saturatedFatG: parseAmount(o.saturatedFatContent, "g"),
    fibreG: parseAmount(o.fiberContent ?? o.fibreContent, "g"),
    sugarG: parseAmount(o.sugarContent, "g"),
    sodiumMg: parseAmount(o.sodiumContent, "mg"),
  };
  if (Object.values(out).every((x) => x == null)) return null;
  out.source = "Imported from the recipe page";
  return out;
}
