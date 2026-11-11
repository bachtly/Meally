/** Foods that have no plural form in a recipe ("2 cups garlic" never "garlics"). */
const INVARIANT = new Set([
  "garlic", "rice", "flour", "sugar", "salt", "butter", "oil", "water", "milk", "cheese", "honey", "cream", "pepper flakes",
  "fish", "shrimp", "sheep", "venison", "bread", "pasta", "meat", "beef", "pork", "chicken", "lamb", "turkey", "ham",
  "bacon", "yeast", "vinegar", "wine", "broth", "stock", "juice", "ginger", "cinnamon", "cocoa", "coffee", "tea", "oats",
  "celery", "parsley", "cilantro", "basil", "dill", "thyme", "oregano", "mint", "rosemary", "sage", "spinach", "kale",
  "lettuce", "broccoli", "cauliflower", "corn", "cornstarch", "cornmeal", "semolina", "tofu", "tempeh", "mayonnaise",
  "ketchup", "mustard", "soy sauce", "salsa", "hummus", "yogurt", "yoghurt", "olive oil", "vanilla", "nutmeg", "paprika",
  "cumin", "turmeric", "coriander",
]);
const IRREGULAR: Record<string, string> = { leaf: "leaves", loaf: "loaves", knife: "knives", half: "halves", child: "children", tomato: "tomatoes", potato: "potatoes", mango: "mangoes", cherry: "cherries" };

/** Pluralise one English noun with simple rules; words that already look plural are returned unchanged. */
function pluralWord(w: string): string {
  const lower = w.toLowerCase();
  const irr = IRREGULAR[lower];
  if (irr) return w[0] === w[0]!.toUpperCase() && w[0] !== w[0]!.toLowerCase() ? irr[0]!.toUpperCase() + irr.slice(1) : irr;
  if (/(ss|us|is|ous)$/.test(lower)) return lower.endsWith("ss") ? `${w}es` : w;
  if (lower.endsWith("s")) return w;
  if (/(ch|sh|x|z)$/.test(lower)) return `${w}es`;
  if (/[^aeiou]y$/.test(lower)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

/** Pluralise a food name for display ("onion" -> "onions", "red onion" -> "red onions"). Compound phrases are left alone. */
export function pluralise(food: string): string {
  const f = food.trim();
  if (!f || INVARIANT.has(f.toLowerCase())) return food;
  if (/[(),]|\s(?:of|and|or|for|in|with|to)\s/i.test(f)) return food;
  const words = f.split(/\s+/);
  const last = words[words.length - 1]!;
  if (INVARIANT.has(last.toLowerCase())) return food;
  words[words.length - 1] = pluralWord(last);
  return words.join(" ");
}
