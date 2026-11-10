import { adjustIngredient, type Recipe, type UnitChoice } from "@meally/shared";

/** Indexes of ingredients whose food name appears in the step text (whole words, simple plurals). */
export function ingredientsForStep(text: string, ingredients: { food: string | null }[]): number[] {
  const hay = text.toLowerCase();
  const hits: number[] = [];
  ingredients.forEach((ing, i) => {
    const food = ing.food?.toLowerCase().trim();
    if (!food || food.length < 3) return;
    const stem = food.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : ""));
    const forms = new Set([food, stem, `${stem}s`, `${stem}es`]);
    const esc = [...forms].map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (new RegExp(`(?<![a-z])(?:${esc.join("|")})(?![a-z])`).test(hay)) hits.push(i);
  });
  return hits;
}

/** Reads `?servings=&units=` the same way the recipe page does. */
export function scaledIngredients(r: Recipe, params: URLSearchParams, scalingOn: boolean) {
  const wanted = Number(params.get("servings"));
  const original = r.servings;
  const servings = scalingOn && original != null && Number.isInteger(wanted) && wanted >= 1 && wanted <= 999 ? wanted : original;
  const u = params.get("units");
  const units: UnitChoice = scalingOn && (u === "metric" || u === "us") ? u : "original";
  const factor = original != null && servings != null ? servings / original : 1;
  return r.ingredients.map((ing) => (scalingOn ? adjustIngredient(ing, factor, units) : ing));
}
