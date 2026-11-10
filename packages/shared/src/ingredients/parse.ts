import { findUnit, MAX_UNIT_WORDS } from "../units/units.js";

export interface ParsedIngredient {
  quantity: number | null;
  quantityMax: number | null;
  /** Canonical unit key from UNITS, or null. */
  unit: string | null;
  food: string | null;
  note: string | null;
  raw: string;
}

const UNI: Record<string, string> = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅕": "1/5", "⅖": "2/5", "⅗": "3/5", "⅘": "4/5",
  "⅙": "1/6", "⅚": "5/6", "⅐": "1/7", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅑": "1/9", "⅒": "1/10",
};
const UNI_CLASS = "[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒]";

function normalizeFractions(s: string): string {
  return s
    .replace(new RegExp(`(\\d)\\s*(${UNI_CLASS})`, "g"), (_, d: string, f: string) => `${d} ${UNI[f]}`)
    .replace(new RegExp(UNI_CLASS, "g"), (f) => UNI[f]!)
    .replace(/⁄/g, "/");
}

const NUM = String.raw`(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:[.,]\d+)?|[.,]\d+)`;
const QTY_RE = new RegExp(String.raw`^(${NUM})(?:\s*(?:-|–|—|to)\s*(${NUM}))?(?![\d/])`, "i");

function toNumber(t: string): number {
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return +mixed[1]! + +mixed[2]! / +mixed[3]!;
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return +frac[1]! / +frac[2]!;
  return parseFloat(t.replace(",", "."));
}
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Remove a leading bullet, dash or list number ("- ", "* ", "• ", "1. "). */
export function stripBullet(line: string): string {
  return line.replace(/^\s*(?:[-*•–—▪◦·>]+|\d+[.)])\s+/, "").trim();
}

/** "For the sauce:", "Sauce:", "## Dough", "MARINADE". */
export function isSectionHeader(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 60) return false;
  if (/^#{1,6}\s+\S/.test(t)) return true;
  if (/\d/.test(t)) return false;
  if (/^(?:for|to make)\s+the\b/i.test(t)) return true;
  if (t.endsWith(":")) return true;
  if (/^[A-Z][A-Z\s&'-]{2,}$/.test(t) && !findUnit(t)) return true;
  return false;
}

const TRAILING_NOTE_RE =
  /\s*(?:,\s*)?\b(to taste|as needed|as required|for serving|for garnish|for dusting|for frying|for greasing|optional|divided)\s*$/i;

/** Split off notes: parenthesised bits and anything after the first top-level comma. */
function splitNote(rest: string): { food: string; note: string | null } {
  const notes: string[] = [];
  let out = "";
  let depth = 0;
  let paren = "";
  let tail = "";
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i]!;
    if (ch === "(") {
      if (depth++ === 0) continue;
    } else if (ch === ")" && depth > 0) {
      if (--depth === 0) {
        if (paren.trim()) notes.push(paren.trim());
        paren = "";
        continue;
      }
    }
    if (depth > 0) paren += ch;
    else if (ch === ",") {
      tail = rest.slice(i + 1).trim();
      break;
    } else out += ch;
  }
  if (paren.trim()) notes.push(paren.trim());
  if (tail) notes.push(tail);
  let food = out.replace(/\s+/g, " ").trim();
  const m = TRAILING_NOTE_RE.exec(food);
  if (m && m.index > 0) {
    notes.unshift(m[1]!.toLowerCase());
    food = food.slice(0, m.index).trim();
  } else if (tail && /^(to taste|as needed|for serving|for garnish|optional|divided)$/i.test(tail)) {
    // already in notes
  }
  food = food.replace(/^of\s+/i, "").replace(/[\s,;:-]+$/, "");
  return { food, note: notes.length ? notes.join("; ") : null };
}

/** Optional household vocabulary. The parser stays pure: the caller loads and passes this in. */
export interface ParseVocab {
  /** Household-defined units; `names` are extra spellings, matched case-insensitively. */
  units?: Array<{ key: string; names: string[] }>;
  /** Foods with their other spellings; a parsed food matching one becomes `name`. */
  foods?: Array<{ name: string; plural?: string | null; aliases?: string[] }>;
}

function takeUnit(s: string, allow?: (key: string) => boolean, vocab?: ParseVocab): { unit: string; rest: string } | null {
  const words = s.split(/\s+/);
  const custom = new Map<string, string>();
  for (const u of vocab?.units ?? []) for (const n of u.names) custom.set(n.toLowerCase(), u.key);
  const maxWords = Math.max(MAX_UNIT_WORDS, ...[...custom.keys()].map((n) => n.split(" ").length));
  for (let n = Math.min(maxWords, words.length); n >= 1; n--) {
    const phrase = words.slice(0, n).join(" ");
    const ck = custom.get(phrase.toLowerCase().replace(/\.$/, ""));
    if (ck && (!allow || allow(ck))) return { unit: ck, rest: words.slice(n).join(" ") };
    const def = findUnit(phrase);
    if (def && (!allow || allow(def.key))) return { unit: def.key, rest: words.slice(n).join(" ") };
  }
  return null;
}

/** The canonical household food name for a parsed food, or the input when nothing matches. */
export function canonicalFood(food: string, foods: ParseVocab["foods"]): string {
  const f = food.trim().toLowerCase();
  for (const c of foods ?? []) {
    if ([c.name, c.plural ?? "", ...(c.aliases ?? [])].some((n) => n && n.trim().toLowerCase() === f)) return c.name;
  }
  return food;
}

export function parseIngredient(line: string, vocab?: ParseVocab): ParsedIngredient {
  const raw = line;
  let s = normalizeFractions(stripBullet(line.replace(/ /g, " "))).replace(/\s+/g, " ").trim();
  const result: ParsedIngredient = { quantity: null, quantityMax: null, unit: null, food: null, note: null, raw };
  if (!s) return result;

  const extra: string[] = [];
  const q = QTY_RE.exec(s);
  if (q) {
    result.quantity = round(toNumber(q[1]!));
    if (q[2]) {
      const max = round(toNumber(q[2]));
      if (max > result.quantity) result.quantityMax = max;
    }
    s = s.slice(q[0].length).trim();
    // size before the unit: "1 (14 oz) can tomatoes"
    const par = /^\(([^)]*)\)\s*(.*)$/.exec(s);
    if (par && takeUnit(par[2]!, undefined, vocab)) {
      extra.push(par[1]!.trim());
      s = par[2]!;
    }
    const tu = takeUnit(s, undefined, vocab);
    if (tu) {
      result.unit = tu.unit;
      s = tu.rest.replace(/^of\s+/i, "");
    }
  } else {
    const tu = takeUnit(s, (k) => k === "pinch" || k === "dash", vocab);
    if (tu) {
      result.unit = tu.unit;
      s = tu.rest.replace(/^of\s+/i, "");
    }
  }

  const { food, note } = splitNote(s);
  const notes = [...extra, ...(note ? [note] : [])];
  result.food = food ? canonicalFood(food, vocab?.foods) : null;
  result.note = notes.length ? notes.join("; ") : null;
  return result;
}

/** Split pasted text into ingredient lines. Blank lines are dropped; section headers label the lines below them. */
export function parseIngredients(text: string, vocab?: ParseVocab): Array<ParsedIngredient & { section?: string }> {
  const out: Array<ParsedIngredient & { section?: string }> = [];
  let section: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (isSectionHeader(line)) {
      section = line.trim().replace(/^#+\s*/, "").replace(/:$/, "").trim();
      continue;
    }
    const p = parseIngredient(line, vocab);
    out.push(section ? { ...p, section } : p);
  }
  return out;
}
