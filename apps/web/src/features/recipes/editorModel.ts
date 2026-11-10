import { isSectionHeader, parseIngredient, parseIngredients, recipeInputSchema, stripBullet, type Recipe, type RecipeInput } from "@meally/shared";

export type RowKind = "item" | "header";
export interface Row {
  id: string;
  kind: RowKind;
  text: string;
}

let counter = 0;
export const newId = () => `row${++counter}`;
export const newRow = (text = "", kind: RowKind = "item"): Row => ({ id: newId(), kind, text });

/** Group flat recipe rows into item rows with a header row wherever the section changes. */
export function rowsFromRecipe(items: Array<{ section: string | null; text: string }>): Row[] {
  const rows: Row[] = [];
  let section: string | null = null;
  for (const it of items) {
    if (it.section && it.section !== section) rows.push(newRow(it.section, "header"));
    section = it.section;
    rows.push(newRow(it.text));
  }
  return rows.length ? rows : [newRow()];
}

/** Turn pasted multi-line text into ingredient rows; section headers become header rows. */
export function rowsFromPaste(text: string): Row[] {
  const rows: Row[] = [];
  let section: string | undefined;
  for (const p of parseIngredients(text)) {
    if (p.section && p.section !== section) rows.push(newRow(p.section, "header"));
    section = p.section;
    rows.push(newRow(stripBullet(p.raw)));
  }
  return rows;
}

export interface FormState {
  name: string;
  description: string;
  prep: string;
  cook: string;
  total: string;
  totalEdited: boolean;
  servings: string;
  yieldText: string;
  sourceUrl: string;
  notes: string;
  ingredients: Row[];
  steps: Row[];
  tags: string[];
  categories: string[];
  tools: string[];
}

export function initialForm(r?: Recipe): FormState {
  const n = (v: number | null | undefined) => (v == null ? "" : String(v));
  const sum = (r?.prepMinutes ?? 0) + (r?.cookMinutes ?? 0);
  return {
    name: r?.name ?? "",
    description: r?.description ?? "",
    prep: n(r?.prepMinutes),
    cook: n(r?.cookMinutes),
    total: n(r?.totalMinutes),
    totalEdited: r ? r.totalMinutes != null && r.totalMinutes !== sum : false,
    servings: n(r?.servings),
    yieldText: r?.yieldText ?? "",
    sourceUrl: r?.sourceUrl ?? "",
    notes: r?.notes ?? "",
    ingredients: rowsFromRecipe((r?.ingredients ?? []).map((i) => ({ section: i.section, text: i.raw }))),
    steps: rowsFromRecipe((r?.steps ?? []).map((s) => ({ section: s.section, text: s.text }))),
    tags: (r?.tags ?? []).map((o) => o.name),
    categories: (r?.categories ?? []).map((o) => o.name),
    tools: (r?.tools ?? []).map((o) => o.name),
  };
}

export const autoTotal = (f: Pick<FormState, "prep" | "cook">): string => {
  if (f.prep === "" && f.cook === "") return "";
  return String((Number(f.prep) || 0) + (Number(f.cook) || 0));
};
export const shownTotal = (f: FormState) => (f.totalEdited ? f.total : autoTotal(f));

/** A comparable snapshot (ignores row ids) for the unsaved-changes check. */
export const snapshot = (f: FormState, hasPhoto: boolean) =>
  JSON.stringify({ ...f, total: shownTotal(f), ingredients: f.ingredients.map(({ kind, text }) => [kind, text]), steps: f.steps.map(({ kind, text }) => [kind, text]), hasPhoto });

export type Errors = Partial<Record<"name" | "prep" | "cook" | "total" | "servings" | "sourceUrl" | "form", string>>;

function num(v: string, int: boolean): number | null | "bad" {
  if (v.trim() === "") return null;
  const x = Number(v);
  if (!Number.isFinite(x) || x < 0 || (int && !Number.isInteger(x))) return "bad";
  return x;
}

export function buildInput(f: FormState, withOrganizers = false): { input?: RecipeInput; errors: Errors } {
  const errors: Errors = {};
  const prep = num(f.prep, true);
  const cook = num(f.cook, true);
  const total = num(shownTotal(f), true);
  const servings = num(f.servings, false);
  if (prep === "bad") errors.prep = "Whole minutes only";
  if (cook === "bad") errors.cook = "Whole minutes only";
  if (total === "bad") errors.total = "Whole minutes only";
  if (servings === "bad" || servings === 0) errors.servings = "Enter a number above zero";

  let sourceUrl = f.sourceUrl.trim();
  if (sourceUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(sourceUrl)) sourceUrl = `https://${sourceUrl}`;

  const ingredients: NonNullable<RecipeInput["ingredients"]> = [];
  let section: string | null = null;
  for (const row of f.ingredients) {
    const text = row.text.trim();
    if (!text) continue;
    if (row.kind === "header" || isSectionHeader(text)) {
      section = text.replace(/^#+\s*/, "").replace(/:$/, "").trim();
      continue;
    }
    const p = parseIngredient(text);
    ingredients.push({ section, quantity: p.quantity, unit: p.unit, food: p.food, note: p.note, raw: text });
  }
  const steps: NonNullable<RecipeInput["steps"]> = [];
  section = null;
  for (const row of f.steps) {
    const text = row.text.trim();
    if (!text) continue;
    if (row.kind === "header") {
      section = text;
      continue;
    }
    steps.push({ section, text });
  }

  const input: RecipeInput = {
    name: f.name,
    description: f.description,
    yieldText: f.yieldText,
    servings: servings === "bad" ? null : servings,
    prepMinutes: prep === "bad" ? null : prep,
    cookMinutes: cook === "bad" ? null : cook,
    totalMinutes: total === "bad" ? null : total,
    sourceUrl: sourceUrl || null,
    notes: f.notes,
    ingredients,
    steps,
    ...(withOrganizers ? { tags: f.tags, categories: f.categories, tools: f.tools } : {}),
  };
  const parsed = recipeInputSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0]);
      if (key === "name" || key === "sourceUrl") errors[key] ??= issue.message;
      else errors.form ??= issue.message;
    }
  }
  return { input: Object.keys(errors).length ? undefined : input, errors };
}
