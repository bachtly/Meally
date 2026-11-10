import { parse, type HTMLElement } from "node-html-parser";
import { parseIngredient, type RecipeInput } from "@meally/shared";

export interface ExtractedRecipe {
  recipe: RecipeInput;
  /** Absolute image URL, if the page gave one. */
  imageUrl: string | null;
  /** Suggestions for tags and categories (organisers). */
  keywords: string[];
  categories: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "..." };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}
/** Strips tags and entities, keeping line breaks for block elements. */
export function cleanText(s: unknown): string {
  if (typeof s !== "string") return "";
  return decodeEntities(s.replace(/<\s*(br|\/p|\/li|\/div)\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""))
    .replace(/[ \t\r\f\v ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** ISO 8601 duration (PT1H30M, P1DT2H, PT45M) to whole minutes; null when unparseable. */
export function parseDuration(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^P(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i.exec(v.trim());
  if (!m || !m.slice(1).some(Boolean)) return null;
  const n = (x?: string) => (x ? parseFloat(x.replace(",", ".")) : 0);
  const mins = n(m[1]) * 7 * 1440 + n(m[2]) * 1440 + n(m[3]) * 60 + n(m[4]) + n(m[5]) / 60;
  return Math.round(mins);
}

const asArray = (v: unknown): unknown[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
export type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function hasType(node: Obj, type: string) {
  return asArray(node["@type"]).some((t) => typeof t === "string" && t.split(/[/#]/).pop()!.toLowerCase() === type.toLowerCase());
}

/** Depth-first search for a Recipe node in @graph, arrays, mainEntity and other nesting. */
function findRecipe(node: unknown, depth = 0): Obj | null {
  if (depth > 8) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (!isObj(node)) return null;
  if (hasType(node, "Recipe")) return node;
  for (const key of ["@graph", "mainEntity", "mainEntityOfPage", "itemListElement", "item"]) {
    const r = findRecipe(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

function text(v: unknown): string {
  if (typeof v === "string") return cleanText(v);
  if (isObj(v)) return cleanText(v.text ?? v.name);
  return "";
}

function imageOf(v: unknown, base: string): string | null {
  const cands: Array<{ url: string; w: number }> = [];
  const visit = (x: unknown) => {
    if (typeof x === "string") cands.push({ url: x, w: 0 });
    else if (Array.isArray(x)) x.forEach(visit);
    else if (isObj(x)) {
      const u = x.url ?? x.contentUrl ?? x["@id"];
      if (typeof u === "string") cands.push({ url: u, w: Number(x.width) || 0 });
    }
  };
  visit(v);
  cands.sort((a, b) => b.w - a.w);
  for (const c of cands) {
    try {
      const u = new URL(c.url.trim(), base);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {
      /* try next */
    }
  }
  return null;
}

export function yieldOf(v: unknown): { yieldText: string | null; servings: number | null } {
  const first = asArray(v)[0];
  const s = typeof first === "number" ? String(first) : text(first);
  if (!s) return { yieldText: null, servings: null };
  const n = /\d+(?:\.\d+)?/.exec(s);
  const servings = n ? parseFloat(n[0]) : null;
  return { yieldText: /^\d+$/.test(s) ? `${s} servings` : s, servings: servings && servings > 0 && servings <= 1000 ? servings : null };
}

export type Step = { text: string; section: string | null };
export function stepsOf(v: unknown, section: string | null = null, depth = 0): Step[] {
  if (depth > 4 || v == null) return [];
  if (typeof v === "string") {
    return cleanText(v)
      .split(/\n+/)
      .map((t) => t.replace(/^\s*(?:step\s*)?\d+[.):]\s+/i, "").trim())
      .filter(Boolean)
      .map((t) => ({ text: t, section }));
  }
  if (Array.isArray(v)) return v.flatMap((x) => stepsOf(x, section, depth + 1));
  if (isObj(v)) {
    if (hasType(v, "HowToSection") || (v.itemListElement && !v.text)) {
      return stepsOf(v.itemListElement, text(v.name) || section, depth + 1);
    }
    const t = text(v);
    return t ? [{ text: t, section }] : [];
  }
  return [];
}

export function listOf(v: unknown): string[] {
  const items = asArray(v).flatMap((x) => (typeof x === "string" ? x.split(",") : []));
  return [...new Set(items.map((s) => cleanText(s)).filter(Boolean))].slice(0, 30);
}

export function ingredientRow(line: string, section: string | null = null) {
  const raw = cleanText(line);
  if (!raw) return null;
  const p = parseIngredient(raw);
  return { section, quantity: p.quantity, unit: p.unit, food: p.food, note: p.note, raw: raw.slice(0, 500) };
}

function ingredientsOf(lines: string[]) {
  return lines.map((l) => ingredientRow(l)).filter((r): r is NonNullable<typeof r> => r !== null);
}

export interface Fields {
  name: string;
  description: string;
  image: unknown;
  yield: unknown;
  prep: unknown;
  cook: unknown;
  total: unknown;
  ingredients: string[];
  instructions: unknown;
  keywords: unknown;
  category: unknown;
}

export function build(f: Fields, url: string | null, ready?: NonNullable<RecipeInput["ingredients"]>): ExtractedRecipe | null {
  const ingredients = ready ?? ingredientsOf(f.ingredients);
  const steps = stepsOf(f.instructions);
  if (!f.name || (!ingredients.length && !steps.length)) return null;
  const y = yieldOf(f.yield);
  return {
    recipe: {
      name: f.name.slice(0, 200),
      description: f.description.slice(0, 5000) || null,
      yieldText: y.yieldText?.slice(0, 120) ?? null,
      servings: y.servings,
      prepMinutes: parseDuration(f.prep),
      cookMinutes: parseDuration(f.cook),
      totalMinutes: parseDuration(f.total),
      sourceUrl: url || null,
      ingredients: ingredients.slice(0, 200),
      steps: steps.slice(0, 200).map((s) => ({ ...s, text: s.text.slice(0, 5000) })),
    },
    imageUrl: url ? imageOf(f.image, url) : null,
    keywords: listOf(f.keywords),
    categories: listOf(f.category),
  };
}

/** Maps one schema.org Recipe node. `url` is the source link, or null when the recipe came from a file. */
export function recipeFromNode(r: Obj, url: string | null): ExtractedRecipe | null {
  return build(
    {
      name: text(r.name),
      description: text(r.description),
      image: r.image,
      yield: r.recipeYield,
      prep: r.prepTime,
      cook: r.cookTime,
      total: r.totalTime,
      ingredients: asArray(r.recipeIngredient ?? r.ingredients).filter((x): x is string => typeof x === "string"),
      instructions: r.recipeInstructions,
      keywords: r.keywords,
      category: r.recipeCategory,
    },
    url,
  );
}

/** Every Recipe node in parsed JSON-LD (a single recipe, an array, or an @graph). */
export function findAllRecipes(node: unknown, depth = 0, out: Obj[] = []): Obj[] {
  if (depth > 8 || out.length > 20_000) return out;
  if (Array.isArray(node)) node.forEach((n) => findAllRecipes(n, depth + 1, out));
  else if (isObj(node)) {
    if (hasType(node, "Recipe")) out.push(node);
    else for (const k of ["@graph", "mainEntity", "itemListElement", "item"]) findAllRecipes(node[k], depth + 1, out);
  }
  return out;
}

/** A recipe's own http(s) link, when the JSON-LD names one. */
export function nodeSourceUrl(r: Obj): string | null {
  for (const v of [r.url, r.mainEntityOfPage, isObj(r.mainEntityOfPage) ? r.mainEntityOfPage["@id"] : null]) {
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) return v.trim().slice(0, 2000);
  }
  return null;
}

function fromJsonLd(root: HTMLElement, url: string): ExtractedRecipe | null {
  for (const el of root.querySelectorAll('script[type="application/ld+json"]')) {
    let data: unknown;
    try {
      data = JSON.parse(el.text.trim().replace(/^﻿/, ""));
    } catch {
      continue;
    }
    const r = findRecipe(data);
    if (!r) continue;
    const out = recipeFromNode(r, url);
    if (out) return out;
  }
  return null;
}

function fromMicrodata(root: HTMLElement, url: string): ExtractedRecipe | null {
  const scope = root.querySelectorAll("[itemtype]").find((e) => /schema\.org\/Recipe$/i.test(e.getAttribute("itemtype") ?? ""));
  if (!scope) return null;
  // Props belonging to this recipe, not to a nested item scope (such as a nutrition block).
  const props = (name: string) =>
    scope.querySelectorAll(`[itemprop~="${name}"]`).filter((e) => {
      for (let p = e.parentNode as HTMLElement | null; p && p !== scope; p = p.parentNode as HTMLElement | null)
        if (p.hasAttribute?.("itemscope")) return false;
      return true;
    });
  const val = (e: HTMLElement) =>
    e.getAttribute("content") ?? e.getAttribute("datetime") ?? (e.tagName === "IMG" ? e.getAttribute("src") : null) ?? e.text;
  const one = (name: string) => {
    const e = props(name)[0];
    return e ? val(e) : "";
  };
  const many = (name: string) => props(name).map(val);
  const instructions = props("recipeInstructions").flatMap((e) => {
    const items = e.querySelectorAll("li");
    return items.length ? items.map((i) => i.text) : [e.text];
  });
  return build(
    {
      name: cleanText(one("name")),
      description: cleanText(one("description")),
      image: props("image").map((e) => e.getAttribute("src") ?? e.getAttribute("content") ?? e.getAttribute("href") ?? ""),
      yield: one("recipeYield"),
      prep: one("prepTime"),
      cook: one("cookTime"),
      total: one("totalTime"),
      ingredients: [...many("recipeIngredient"), ...many("ingredients")],
      instructions: instructions.join("\n"),
      keywords: one("keywords"),
      category: one("recipeCategory"),
    },
    url,
  );
}

/** Finds a schema.org Recipe in JSON-LD, falling back to microdata. Null when the page has none. */
export function extractRecipe(html: string, url: string): ExtractedRecipe | null {
  const root = parse(html, { blockTextElements: { script: true, noscript: false, style: false, pre: true } });
  return fromJsonLd(root, url) ?? fromMicrodata(root, url);
}
