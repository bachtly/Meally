import {
  build,
  cleanText,
  ingredientRow,
  listOf,
  type ExtractedRecipe,
  type Obj,
} from "../import-url/extract.js";

/**
 * RecipeSage JSON-LD export (see docs/design/features/import-recipesage.md).
 * One file `{ "recipes": [Recipe, ...] }`; images are URLs; section headers are
 * `[Header]` ingredient lines and HowToSection steps without children.
 */
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const HEADER = /^\[(.+)\]$/;
const MAX_IMAGE_DATA = 10 * 1024 * 1024;

function isRecipe(n: unknown): n is Obj {
  return isObj(n) && arr(n["@type"]).some((t) => str(t).toLowerCase().endsWith("recipe"));
}

/** True for RecipeSage's wrapper object, or any file whose recipes carry RecipeSage-only markers. */
export function isRecipeSageFile(data: unknown): boolean {
  if (isObj(data) && Array.isArray(data.recipes)) return data.recipes.some(isRecipe);
  const list = Array.isArray(data) ? data : [data];
  return list.some((n) => isRecipe(n) && (typeof n.creditText === "string" || arr(n.comment).some((c) => isObj(c) && c.name === "Author Notes")));
}

export function recipeSageNodes(data: unknown): Obj[] {
  const list = isObj(data) && Array.isArray(data.recipes) ? data.recipes : Array.isArray(data) ? data : [data];
  return list.filter(isRecipe);
}

/** First usable image: http(s) URL, or an inline PNG/JPEG/WebP data URI. */
export function imageOfNode(n: Obj): { url?: string; data?: Buffer } {
  const flat = [...arr(n.images), ...arr(n.image)].flatMap((x) => (isObj(x) ? [x.url] : [x]));
  for (const x of flat) {
    const s = str(x).trim();
    if (/^https?:\/\//i.test(s)) {
      try {
        return { url: new URL(s).href };
      } catch {
        continue;
      }
    }
    const m = /^data:image\/(?:png|jpe?g|webp);base64,(.+)$/is.exec(s);
    if (m && m[1]!.length < MAX_IMAGE_DATA * 1.4) return { data: Buffer.from(m[1]!, "base64") };
  }
  return {};
}

/** Rating 1..5 from aggregateRating.ratingValue (a string in RecipeSage exports). */
export function ratingOfNode(n: Obj): number | null {
  const a = n.aggregateRating;
  if (!isObj(a)) return null;
  const v = parseFloat(str(a.ratingValue));
  const best = parseFloat(str(a.bestRating)) || 5;
  if (!Number.isFinite(v) || v <= 0) return null;
  const r = Math.round((v / best) * 5);
  return r >= 1 && r <= 5 ? r : null;
}

export interface RecipeSageExtra {
  extracted: ExtractedRecipe;
  rating: number | null;
  imageUrl: string | null;
  imageData: Buffer | null;
}

export function recipeSageRecipe(n: Obj, looseMinutes: (v: unknown) => number | null): RecipeSageExtra | null {
  let section: string | null = null;
  const ingredients: NonNullable<ExtractedRecipe["recipe"]["ingredients"]> = [];
  for (const x of arr(n.recipeIngredient)) {
    const line = cleanText(isObj(x) ? x.text : x);
    if (!line) continue;
    const h = HEADER.exec(line);
    if (h) {
      section = h[1]!.trim().slice(0, 120);
      continue;
    }
    const row = ingredientRow(line, section);
    if (row) ingredients.push(row);
  }

  const steps: Array<{ text: string; section: string | null }> = [];
  let stepSection: string | null = null;
  const addStep = (x: unknown) => {
    const t = cleanText(isObj(x) ? (x.text ?? x.name) : x);
    if (!t) return;
    const h = HEADER.exec(t);
    if (h) stepSection = h[1]!.trim().slice(0, 120);
    else steps.push({ text: t.slice(0, 5000), section: stepSection });
  };
  const rawSteps = typeof n.recipeInstructions === "string" ? n.recipeInstructions.split(/\n+/) : arr(n.recipeInstructions);
  for (const x of rawSteps) {
    if (isObj(x) && str(x["@type"]).endsWith("HowToSection")) {
      const name = cleanText(x.name ?? x.text);
      if (name) stepSection = name.slice(0, 120);
      arr(x.itemListElement).forEach(addStep);
    } else addStep(x);
  }

  const notes = arr(n.comment)
    .filter((c): c is Obj => isObj(c) && c.name === "Author Notes")
    .map((c) => cleanText(c.text))
    .filter(Boolean)
    .join("\n\n");
  const link = str(n.isBasedOn).trim();
  const credit = cleanText(n.creditText);
  const author = isObj(n.author) ? cleanText(n.author.name) : cleanText(n.author);
  const credited = credit || author;
  const rating = ratingOfNode(n);

  const extracted = build(
    {
      name: cleanText(n.name),
      description: cleanText(n.description),
      image: null,
      yield: arr(n.recipeYield).find((y) => str(y)) ?? null,
      prep: null,
      cook: null,
      total: null,
      ingredients: [],
      instructions: steps.map((s) => s.text),
      keywords: null,
      category: null,
    },
    /^https?:\/\//i.test(link) ? link.slice(0, 2000) : null,
    ingredients.slice(0, 200),
  );
  if (!extracted) return null;
  const r = extracted.recipe;
  r.steps = steps.slice(0, 200);
  // prepTime is RecipeSage's "active time"; times may be ISO 8601 or free text.
  const first = (v: unknown) => arr(v).find((x) => str(x));
  r.prepMinutes = looseMinutes(first(n.prepTime));
  r.totalMinutes = looseMinutes(first(n.totalTime) ?? first(n.cookTime));
  const noteParts = [notes];
  // A source with no link is a free-text credit, e.g. "Grandma"; keep it visible.
  if (credited && !r.sourceUrl) noteParts.push(`Source: ${credited}`);
  else if (credited && credited !== link) noteParts.push(`Source: ${credited}`);
  extracted.categories = [];
  extracted.keywords = listOf(arr(n.recipeCategory).flatMap((c) => (isObj(c) ? [c.name] : [c])).flatMap((c) => (typeof c === "string" ? c.split(",") : [])).join(","));
  const img = imageOfNode(n);
  return { extracted: { ...extracted, recipe: { ...r, notes: noteParts.filter(Boolean).join("\n\n").slice(0, 10_000) || null } }, rating, imageUrl: img.url ?? null, imageData: img.data ?? null };
}
