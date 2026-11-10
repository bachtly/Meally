import fs from "node:fs";
import { asc, eq } from "drizzle-orm";
import type { Recipe } from "@meally/shared";
import type { Db } from "../../db/index.js";
import { recipes } from "../../db/schema/index.js";
import { findRow, getRecipe, imagePath } from "../recipes/service.js";
import type { ZipWriter } from "./zipwriter.js";

export const exportFormats = ["jsonld", "markdown"] as const;
export type ExportFormat = (typeof exportFormats)[number];

const iso = (m: number | null) => {
  if (!m || m <= 0) return undefined;
  const h = Math.floor(m / 60);
  return `PT${h ? `${h}H` : ""}${m % 60 ? `${m % 60}M` : ""}`;
};

/** schema.org Recipe node. Round-trips through our own JSON-LD importer (name, times, yield, ingredients, steps, keywords). */
export function toJsonLd(r: Recipe, imageFile: string | null): Record<string, unknown> {
  const steps: unknown[] = [];
  let section: { "@type": "HowToSection"; name: string; itemListElement: unknown[] } | null = null;
  for (const s of r.steps) {
    const step = { "@type": "HowToStep", text: s.text };
    if (s.section) {
      if (!section || section.name !== s.section) {
        section = { "@type": "HowToSection", name: s.section, itemListElement: [] };
        steps.push(section);
      }
      section.itemListElement.push(step);
    } else {
      section = null;
      steps.push(step);
    }
  }
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: r.name,
    description: r.description ?? undefined,
    url: r.sourceUrl ?? undefined,
    image: imageFile ?? undefined,
    recipeYield: r.yieldText ?? (r.servings ? String(r.servings) : undefined),
    prepTime: iso(r.prepMinutes),
    cookTime: iso(r.cookMinutes),
    totalTime: iso(r.totalMinutes),
    recipeIngredient: r.ingredients.map((i) => i.raw),
    recipeInstructions: steps,
    keywords: r.tags?.length ? r.tags.map((t) => t.name).join(", ") : undefined,
    recipeCategory: r.categories?.length ? r.categories.map((t) => t.name).join(", ") : undefined,
    dateCreated: new Date(r.createdAt).toISOString(),
    dateModified: new Date(r.updatedAt).toISOString(),
  };
  return Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined));
}

const q = (s: string) => JSON.stringify(s);
const yamlList = (k: string, v: string[]) => (v.length ? [`${k}:`, ...v.map((x) => `  - ${q(x)}`)] : []);

export function toMarkdown(r: Recipe, imageFile: string | null): string {
  const fm = [
    "---",
    `title: ${q(r.name)}`,
    ...(r.sourceUrl ? [`source: ${q(r.sourceUrl)}`] : []),
    ...(r.yieldText ? [`yield: ${q(r.yieldText)}`] : []),
    ...(r.servings ? [`servings: ${r.servings}`] : []),
    ...(r.prepMinutes != null ? [`prep_minutes: ${r.prepMinutes}`] : []),
    ...(r.cookMinutes != null ? [`cook_minutes: ${r.cookMinutes}`] : []),
    ...(r.totalMinutes != null ? [`total_minutes: ${r.totalMinutes}`] : []),
    ...yamlList("tags", (r.tags ?? []).map((t) => t.name)),
    ...yamlList("categories", (r.categories ?? []).map((t) => t.name)),
    ...(imageFile ? [`image: ${q(imageFile)}`] : []),
    `created: ${new Date(r.createdAt).toISOString()}`,
    `updated: ${new Date(r.updatedAt).toISOString()}`,
    "---",
    "",
  ];
  const body: string[] = [`# ${r.name}`, ""];
  if (r.description) body.push(r.description, "");
  const group = <T extends { section: string | null }>(rows: T[], line: (x: T, i: number) => string) => {
    let cur: string | null | undefined;
    let n = 0;
    for (const row of rows) {
      if (row.section !== cur) {
        cur = row.section;
        if (cur) body.push("", `### ${cur}`, "");
      }
      body.push(line(row, n++));
    }
    body.push("");
  };
  body.push("## Ingredients", "");
  group(r.ingredients, (i) => `- ${i.raw}`);
  body.push("## Steps", "");
  group(r.steps, (s, i) => `${i + 1}. ${s.text}`);
  if (r.notes) body.push("## Notes", "", r.notes, "");
  return `${fm.join("\n")}${body.join("\n")}`.replace(/\n{3,}/g, "\n\n");
}

/** Adds one recipe (and its image) to the zip. Names are unique because slugs are unique per household. */
async function addRecipe(z: ZipWriter, dataDir: string, householdId: string, r: Recipe, imageId: string | null, format: ExportFormat) {
  let imageFile: string | null = null;
  if (imageId) {
    const src = imagePath(dataDir, householdId, imageId, 1600);
    if (fs.existsSync(src)) {
      imageFile = `images/${r.slug}.webp`;
      await z.addFile(imageFile, src, true);
    }
  }
  if (format === "jsonld") z.addBuffer(`recipes/${r.slug}.json`, Buffer.from(JSON.stringify(toJsonLd(r, imageFile), null, 2)));
  else z.addBuffer(`recipes/${r.slug}.md`, Buffer.from(toMarkdown(r, imageFile)));
}

export interface ExportOpts {
  dataDir: string;
  householdId: string;
  org: boolean;
}

export async function exportHousehold(db: Db, z: ZipWriter, o: ExportOpts, format: ExportFormat) {
  const rows = await db
    .select({ slug: recipes.slug, imageId: recipes.imageId })
    .from(recipes)
    .where(eq(recipes.householdId, o.householdId))
    .orderBy(asc(recipes.slug));
  for (const row of rows) {
    const r = await getRecipe(db, o.householdId, row.slug, { org: o.org });
    await addRecipe(z, o.dataDir, o.householdId, r, row.imageId, format);
  }
}

export async function exportOne(db: Db, z: ZipWriter, o: ExportOpts, slug: string, format: ExportFormat) {
  const row = await findRow(db, o.householdId, slug);
  const r = await getRecipe(db, o.householdId, row.slug, { org: o.org });
  await addRecipe(z, o.dataDir, o.householdId, r, row.imageId, format);
}
