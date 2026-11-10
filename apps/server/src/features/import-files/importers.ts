import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseIngredients } from "@meally/shared";
import type { RecipeInput } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";
import {
  build,
  cleanText,
  extractRecipe,
  findAllRecipes,
  ingredientRow,
  listOf,
  nodeSourceUrl,
  parseDuration,
  recipeFromNode,
  type ExtractedRecipe,
} from "../import-url/extract.js";
import { openZip, type ZipArchive, type ZipItem } from "./zip.js";

export type Format = "jsonld" | "paprika" | "mealie" | "zip";

export interface Loaded {
  extracted: ExtractedRecipe;
  /** Raw image bytes from the file, if any. */
  image?: Buffer | null;
}
/** One unit of work: a file, an entry, or a recipe node. It may yield zero, one or many recipes. */
export interface PlanItem {
  label: string;
  load: () => Promise<Loaded[]>;
}
export interface Plan {
  format: Format;
  items: PlanItem[];
  close: () => void;
}

const MAX_JSON_FILE = 200 * 1024 * 1024;
const HTTP = /^https?:\/\//i;
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Durations written in words ("1 hr 15 min", "45 minutes") or ISO 8601. Null when unreadable. */
export function looseDuration(v: unknown): number | null {
  const s = str(v).trim();
  if (!s) return null;
  const iso = parseDuration(s);
  if (iso != null) return iso;
  let mins = 0;
  let hit = false;
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(d(?:ays?)?|h(?:ours?|rs?)?|m(?:in(?:ute)?s?)?)\b/gi)) {
    const n = parseFloat(m[1]!.replace(",", "."));
    const u = m[2]!.toLowerCase()[0];
    mins += u === "d" ? n * 1440 : u === "h" ? n * 60 : n;
    hit = true;
  }
  if (!hit && /^\d+$/.test(s)) return parseInt(s, 10);
  return hit ? Math.round(mins) : null;
}

function jsonLdItems(data: unknown, label: string): PlanItem[] {
  return findAllRecipes(data).map((node, i) => ({
    label: `${label}${i ? ` #${i + 1}` : ""}`,
    load: async () => {
      const r = recipeFromNode(node, nodeSourceUrl(node));
      return r ? [{ extracted: r }] : [];
    },
  }));
}

function parseJson(buf: Buffer): unknown {
  return JSON.parse(buf.toString("utf8").replace(/^﻿/, ""));
}

function htmlExtract(html: string): ExtractedRecipe | null {
  const r = extractRecipe(html, "https://import.invalid/");
  if (!r) return null;
  r.recipe.sourceUrl = null;
  r.imageUrl = null;
  return r;
}

function htmlItem(archive: ZipArchive, it: ZipItem): PlanItem {
  return {
    label: it.name,
    load: async () => {
      const r = htmlExtract((await archive.read(it)).toString("utf8"));
      return r ? [{ extracted: r }] : [];
    },
  };
}

function jsonFileItem(archive: ZipArchive, it: ZipItem): PlanItem {
  return {
    label: it.name,
    load: async () => {
      const found = jsonLdItems(parseJson(await archive.read(it)), it.name);
      return (await Promise.all(found.map((f) => f.load()))).flat();
    },
  };
}

/** Paprika: each entry is one gzipped JSON recipe; the photo is base64 in `photo_data`. */
function paprikaItem(archive: ZipArchive, it: ZipItem): PlanItem {
  return {
    label: it.name.replace(/\.paprikarecipe$/i, ""),
    load: async () => {
      const raw = await archive.read(it);
      let json: Buffer;
      try {
        json = gunzipSync(raw, { maxOutputLength: 100 * 1024 * 1024 });
      } catch {
        json = raw;
      }
      const p = obj(parseJson(json));
      const ingredients = parseIngredients(str(p.ingredients)).map((i) => ({
        section: i.section ?? null,
        quantity: i.quantity,
        unit: i.unit,
        food: i.food,
        note: i.note,
        raw: i.raw,
      }));
      const src = str(p.source_url).trim();
      const extracted = build(
        {
          name: cleanText(str(p.name)),
          description: cleanText(str(p.description)),
          image: null,
          yield: str(p.servings),
          prep: null,
          cook: null,
          total: null,
          ingredients: [],
          instructions: str(p.directions),
          keywords: null,
          category: null,
        },
        HTTP.test(src) ? src : null,
        ingredients.filter((i) => i.raw),
      );
      if (!extracted) return [];
      const r = extracted.recipe;
      r.prepMinutes = looseDuration(p.prep_time);
      r.cookMinutes = looseDuration(p.cook_time);
      r.totalMinutes = looseDuration(p.total_time);
      r.notes = cleanText(str(p.notes)).slice(0, 10_000) || null;
      extracted.categories = listOf(Array.isArray(p.categories) ? p.categories.filter((x) => typeof x === "string") : []);
      const photo = str(p.photo_data);
      return [{ extracted, image: photo ? Buffer.from(photo, "base64") : null }];
    },
  };
}

const MEALIE_JSON = /(?:^|\/)recipes\/[^/]+\/[^/]+\.json$/i;

/** Mealie: `recipes/<slug>/<slug>.json` plus `recipes/<slug>/images/original.*`. Best effort. */
function mealieItem(archive: ZipArchive, it: ZipItem): PlanItem {
  const dir = it.name.slice(0, it.name.lastIndexOf("/"));
  return {
    label: it.name,
    load: async () => {
      const m = obj(parseJson(await archive.read(it)));
      let section: string | null = null;
      const ingredients: NonNullable<RecipeInput["ingredients"]> = [];
      for (const raw of Array.isArray(m.recipeIngredient) ? m.recipeIngredient : []) {
        const i = obj(raw);
        const title = cleanText(str(i.title));
        if (title) section = title.slice(0, 120);
        const line =
          str(i.originalText) ||
          str(i.display) ||
          [i.quantity ? str(i.quantity) : "", str(obj(i.unit).name), str(obj(i.food).name), str(i.note)].filter(Boolean).join(" ");
        const row = ingredientRow(line, section);
        if (row) ingredients.push(row);
      }
      const steps: Array<{ text: string; section: string | null }> = [];
      let stepSection: string | null = null;
      for (const raw of Array.isArray(m.recipeInstructions) ? m.recipeInstructions : []) {
        const s = obj(raw);
        const title = cleanText(str(s.title));
        if (title) stepSection = title.slice(0, 120);
        const t = cleanText(str(s.text));
        if (t) steps.push({ text: t.slice(0, 5000), section: stepSection });
      }
      const names = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : str(obj(x).name))).filter(Boolean) : []);
      const org = str(m.orgURL).trim();
      const extracted = build(
        {
          name: cleanText(str(m.name)),
          description: cleanText(str(m.description)),
          image: null,
          yield: str(m.recipeYield) || str(m.recipeServings),
          prep: null,
          cook: null,
          total: null,
          ingredients: [],
          instructions: steps.map((s) => s.text),
          keywords: null,
          category: null,
        },
        HTTP.test(org) ? org : null,
        ingredients,
      );
      if (!extracted) return [];
      const r = extracted.recipe;
      r.steps = steps.slice(0, 200);
      r.prepMinutes = looseDuration(m.prepTime);
      r.cookMinutes = looseDuration(m.performTime ?? m.cookTime);
      r.totalMinutes = looseDuration(m.totalTime);
      extracted.keywords = listOf(names(m.tags));
      extracted.categories = listOf(names(m.recipeCategory));
      const imgItem = archive.items.find((x) => x.name.startsWith(`${dir}/images/`) && /\/original\.[a-z0-9]+$/i.test(x.name));
      const image = imgItem ? await archive.read(imgItem, 30 * 1024 * 1024).catch(() => null) : null;
      return [{ extracted, image }];
    },
  };
}

function isZipFile(head: Buffer) {
  return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && (head[2] === 3 || head[2] === 5 || head[2] === 7);
}

/** Detects the format from content (the filename is only a hint), validates, and returns the work to do. */
export async function planImport(file: string, filename: string): Promise<Plan> {
  const fh = await fs.open(file, "r");
  const head = Buffer.alloc(8);
  await fh.read(head, 0, 8, 0);
  await fh.close();

  if (!isZipFile(head)) {
    const ext = path.extname(filename).toLowerCase();
    const stat = await fs.stat(file);
    if (stat.size > MAX_JSON_FILE) throw new ApiError(413, "too_large", "That file is too large");
    const buf = await fs.readFile(file);
    if (ext === ".html" || ext === ".htm") {
      const r = htmlExtract(buf.toString("utf8"));
      if (!r) throw new ApiError(422, "no_recipe_found", "No recipe was found in that file");
      return { format: "jsonld", close() {}, items: [{ label: filename, load: async () => [{ extracted: r }] }] };
    }
    let data: unknown;
    try {
      data = parseJson(buf);
    } catch {
      throw new ApiError(415, "unsupported_format", "That file is not a supported recipe export");
    }
    const items = jsonLdItems(data, filename);
    if (!items.length) throw new ApiError(422, "no_recipe_found", "No schema.org recipes were found in that file");
    return { format: "jsonld", items, close() {} };
  }

  const archive = await openZip(file);
  const entries = archive.items;
  const paprika = entries.filter((i) => /\.paprikarecipe$/i.test(i.name));
  if (paprika.length) return { format: "paprika", items: paprika.map((i) => paprikaItem(archive, i)), close: () => archive.close() };
  const mealie = entries.filter((i) => MEALIE_JSON.test(i.name));
  if (mealie.length) return { format: "mealie", items: mealie.map((i) => mealieItem(archive, i)), close: () => archive.close() };
  const items = entries
    .filter((i) => !i.name.split("/").some((s) => s.startsWith(".") || s === "__MACOSX"))
    .flatMap((i) => (/\.html?$/i.test(i.name) ? [htmlItem(archive, i)] : /\.json$/i.test(i.name) ? [jsonFileItem(archive, i)] : []));
  if (!items.length) {
    archive.close();
    throw new ApiError(415, "unsupported_format", "That zip has no recipes Meally can read (.html or .json files)");
  }
  return { format: "zip", items, close: () => archive.close() };
}
