/** Built-in default aisle for common foods. Names match the default aisle labels. */
const GROUPS: Record<string, string> = {
  Produce:
    "apple banana orange lemon lime grape strawberry blueberry raspberry blackberry cherry peach pear plum mango pineapple melon watermelon avocado tomato potato sweet potato onion red onion shallot scallion green onion leek garlic ginger carrot celery cucumber lettuce spinach kale arugula cabbage broccoli cauliflower zucchini courgette eggplant aubergine pepper bell pepper jalapeno chili mushroom corn pea green bean asparagus beet radish squash pumpkin fennel herb parsley cilantro basil mint dill thyme rosemary sage coriander chive salad",
  Bakery: "bread baguette bun roll bagel tortilla pita naan croissant muffin ciabatta sourdough wrap",
  "Dairy & eggs": "milk butter cheese halloumi paneer cheddar mozzarella parmesan feta ricotta cream sour cream yogurt yoghurt egg buttermilk cream cheese mascarpone half and half ghee",
  "Meat & fish":
    "chicken beef pork lamb turkey bacon sausage ham steak mince ground beef ground turkey salmon tuna cod shrimp prawn fish trout tilapia crab lobster anchovy sardine duck veal ribs chorizo prosciutto",
  Pantry:
    "flour sugar brown sugar rice pasta spaghetti noodle oat oatmeal cereal bean lentil chickpea quinoa couscous oil olive oil vegetable oil vinegar soy sauce stock broth honey syrup maple syrup jam peanut butter tahini mustard ketchup mayonnaise mayo tomato paste tomato sauce passata coconut milk nut almond walnut cashew pecan peanut raisin baking powder baking soda cornstarch cocoa chocolate breadcrumb cracker chip sauce salsa pickle olive caper lentils",
  Spices: "salt black pepper paprika cumin cinnamon nutmeg oregano turmeric chili powder cayenne clove cardamom vanilla curry powder garam masala bay leaf mustard seed coriander seed fennel seed saffron allspice spice seasoning",
  Frozen: "ice cream frozen pea frozen berry frozen pizza frozen fruit frozen vegetable popsicle",
  Drinks: "water juice orange juice coffee tea wine beer soda cola lemonade sparkling water tonic whiskey vodka rum gin",
  Household: "paper towel toilet paper tissue foil aluminum foil plastic wrap parchment paper trash bag sponge soap detergent dish soap napkin",
};

const TABLE = new Map<string, string>();
for (const [aisle, words] of Object.entries(GROUPS)) {
  // Multi-word foods are space separated too; register single words and known pairs greedily.
  for (const w of words.split(" ")) if (!TABLE.has(w)) TABLE.set(w, aisle);
}
// Explicit multi-word entries (win over their single words, e.g. "ice cream" is not Dairy).
const PHRASES: [string, string][] = [
  ["ice cream", "Frozen"], ["sweet potato", "Produce"], ["green onion", "Produce"], ["red onion", "Produce"], ["bell pepper", "Produce"], ["green bean", "Produce"],
  ["black pepper", "Spices"], ["chili powder", "Spices"], ["curry powder", "Spices"], ["bay leaf", "Spices"], ["garam masala", "Spices"],
  ["sour cream", "Dairy & eggs"], ["cream cheese", "Dairy & eggs"], ["half and half", "Dairy & eggs"],
  ["coconut milk", "Pantry"], ["peanut butter", "Pantry"], ["soy sauce", "Pantry"], ["olive oil", "Pantry"], ["maple syrup", "Pantry"], ["tomato paste", "Pantry"], ["tomato sauce", "Pantry"], ["baking powder", "Pantry"], ["baking soda", "Pantry"], ["brown sugar", "Pantry"],
  ["ground beef", "Meat & fish"], ["ground turkey", "Meat & fish"], ["orange juice", "Drinks"], ["sparkling water", "Drinks"],
  ["paper towel", "Household"], ["toilet paper", "Household"], ["aluminum foil", "Household"], ["plastic wrap", "Household"], ["parchment paper", "Household"], ["trash bag", "Household"], ["dish soap", "Household"],
  ["frozen pea", "Frozen"], ["frozen pizza", "Frozen"], ["frozen fruit", "Frozen"], ["frozen vegetable", "Frozen"], ["frozen berry", "Frozen"],
  ["coriander seed", "Spices"], ["fennel seed", "Spices"], ["mustard seed", "Spices"], ["vegetable oil", "Pantry"],
];
const PHRASE_MAP = new Map(PHRASES);

/** Lowercase and crude singular: tomatoes -> tomato, berries -> berry, peas -> pea. */
export function singularWord(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !/(ss|us)$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Default aisle name for a parsed food, or null when unknown. */
export function guessAisle(food: string | null | undefined): string | null {
  if (!food) return null;
  const words = food
    .toLowerCase()
    .replace(/[^a-z\s&]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(singularWord);
  if (!words.length) return null;
  const whole = words.join(" ");
  const direct = PHRASE_MAP.get(whole) ?? TABLE.get(whole);
  if (direct) return direct;
  for (let n = Math.min(3, words.length); n >= 2; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const hit = PHRASE_MAP.get(words.slice(i, i + n).join(" "));
      if (hit) return hit;
    }
  }
  // Head noun is usually last ("red onion", "chicken breast" -> chicken via the scan below).
  const last = TABLE.get(words[words.length - 1]!);
  if (last) return last;
  for (const w of words) {
    const hit = TABLE.get(w);
    if (hit) return hit;
  }
  return null;
}
