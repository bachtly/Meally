import { describe, expect, it } from "vitest";
import { UNITS, findUnit } from "../units/units.js";
import { formatQuantity } from "./format.js";
import { isSectionHeader, parseIngredient, parseIngredients } from "./parse.js";

type C = [string, number | null, number | null, string | null, string | null, string | null];
// line, quantity, quantityMax, unit, food, note
const cases: C[] = [
  ["2 cups flour", 2, null, "cup", "flour", null],
  ["1 cup sugar", 1, null, "cup", "sugar", null],
  ["1,5 kg potatoes", 1.5, null, "kg", "potatoes", null],
  ["0.5 l milk", 0.5, null, "l", "milk", null],
  ["1.25 cups water", 1.25, null, "cup", "water", null],
  ["1/2 tsp salt", 0.5, null, "tsp", "salt", null],
  ["1 1/2 cups milk", 1.5, null, "cup", "milk", null],
  ["3/4 cup sugar", 0.75, null, "cup", "sugar", null],
  ["½ cup butter", 0.5, null, "cup", "butter", null],
  ["1½ cups rice", 1.5, null, "cup", "rice", null],
  ["1 ½ cups rice", 1.5, null, "cup", "rice", null],
  ["⅓ cup honey", 0.333, null, "cup", "honey", null],
  ["¾ tsp cumin", 0.75, null, "tsp", "cumin", null],
  ["2-3 cloves garlic", 2, 3, "clove", "garlic", null],
  ["2 to 3 tbsp olive oil", 2, 3, "tbsp", "olive oil", null],
  ["2–3 carrots", 2, 3, null, "carrots", null],
  ["1/2-1 tsp chili flakes", 0.5, 1, "tsp", "chili flakes", null],
  ["1 tsp vanilla", 1, null, "tsp", "vanilla", null],
  ["2 teaspoons vanilla extract", 2, null, "tsp", "vanilla extract", null],
  ["1 teaspoon baking soda", 1, null, "tsp", "baking soda", null],
  ["1 tbsp butter", 1, null, "tbsp", "butter", null],
  ["2 tablespoons soy sauce", 2, null, "tbsp", "soy sauce", null],
  ["2 Tbsp. honey", 2, null, "tbsp", "honey", null],
  ["1 T sugar", 1, null, "tbsp", "sugar", null],
  ["1 t salt", 1, null, "tsp", "salt", null],
  ["250 ml cream", 250, null, "ml", "cream", null],
  ["250ml cream", 250, null, "ml", "cream", null],
  ["2 liters water", 2, null, "l", "water", null],
  ["500 g flour", 500, null, "g", "flour", null],
  ["500g flour", 500, null, "g", "flour", null],
  ["2 kilograms beef", 2, null, "kg", "beef", null],
  ["8 oz cream cheese", 8, null, "oz", "cream cheese", null],
  ["8 ounces pasta", 8, null, "oz", "pasta", null],
  ["1 lb ground beef", 1, null, "lb", "ground beef", null],
  ["2 lbs chicken thighs", 2, null, "lb", "chicken thighs", null],
  ["1 pound carrots", 1, null, "lb", "carrots", null],
  ["2 fl oz brandy", 2, null, "fl-oz", "brandy", null],
  ["1 pint cream", 1, null, "pint", "cream", null],
  ["1 quart stock", 1, null, "quart", "stock", null],
  ["1 gallon milk", 1, null, "gallon", "milk", null],
  ["1 pinch saffron", 1, null, "pinch", "saffron", null],
  ["pinch of salt", null, null, "pinch", "salt", null],
  ["3 cloves garlic, minced", 3, null, "clove", "garlic", "minced"],
  ["1 clove garlic", 1, null, "clove", "garlic", null],
  ["2 cans chickpeas", 2, null, "can", "chickpeas", null],
  ["1 (14 oz) can tomatoes", 1, null, "can", "tomatoes", "14 oz"],
  ["2 (400 g) tins coconut milk", 2, null, "can", "coconut milk", "400 g"],
  ["1 package yeast", 1, null, "package", "yeast", null],
  ["2 slices bacon", 2, null, "slice", "bacon", null],
  ["1 bunch parsley", 1, null, "bunch", "parsley", null],
  ["2 sprigs thyme", 2, null, "sprig", "thyme", null],
  ["1 stick butter", 1, null, "stick", "butter", null],
  ["2 onions, finely chopped", 2, null, null, "onions", "finely chopped"],
  ["1 large onion, diced", 1, null, null, "large onion", "diced"],
  ["3 eggs", 3, null, null, "eggs", null],
  ["2 large eggs (room temperature)", 2, null, null, "large eggs", "room temperature"],
  ["1 cup flour (sifted), plus more for dusting", 1, null, "cup", "flour", "sifted; plus more for dusting"],
  ["salt to taste", null, null, null, "salt", "to taste"],
  ["Salt and pepper, to taste", null, null, null, "Salt and pepper", "to taste"],
  ["fresh basil for garnish", null, null, null, "fresh basil", "for garnish"],
  ["olive oil", null, null, null, "olive oil", null],
  ["- 2 cups flour", 2, null, "cup", "flour", null],
  ["* 1 tsp salt", 1, null, "tsp", "salt", null],
  ["• 3 eggs", 3, null, null, "eggs", null],
  ["– 1/2 cup milk", 0.5, null, "cup", "milk", null],
  ["1. 2 cups flour", 2, null, "cup", "flour", null],
  ["  2 cups   flour  ", 2, null, "cup", "flour", null],
  ["2 cups of flour", 2, null, "cup", "flour", null],
  ["1 cup (240 ml) water", 1, null, "cup", "water", "240 ml"],
  ["2 C flour", 2, null, "cup", "flour", null],
  ["100 grams butter, softened", 100, null, "g", "butter", "softened"],
  ["", null, null, null, null, null],
];

describe("parseIngredient (table)", () => {
  it.each(cases)("%s", (line, quantity, quantityMax, unit, food, note) => {
    expect(parseIngredient(line)).toEqual({ quantity, quantityMax, unit, food, note, raw: line });
  });
});

describe("raw is preserved", () => {
  it("keeps the exact input", () => {
    expect(parseIngredient("  ½ cup  Butter, melted ").raw).toBe("  ½ cup  Butter, melted ");
  });
});

describe("isSectionHeader", () => {
  it.each(["For the sauce:", "Sauce:", "FOR THE DOUGH", "## Topping", "For the crust", "MARINADE"])("yes: %s", (l) =>
    expect(isSectionHeader(l)).toBe(true),
  );
  it.each(["2 cups flour", "salt", "Olive oil", "1 cup: sugar", ""])("no: %s", (l) =>
    expect(isSectionHeader(l)).toBe(false),
  );
});

describe("parseIngredients", () => {
  it("splits lines, skips blanks and tracks sections", () => {
    const out = parseIngredients("For the dough:\n2 cups flour\n\n- 1 tsp salt\nSauce:\n1 can tomatoes\r\n");
    expect(out.map((o) => [o.food, o.section])).toEqual([
      ["flour", "For the dough"],
      ["salt", "For the dough"],
      ["tomatoes", "Sauce"],
    ]);
  });
});

describe("formatQuantity", () => {
  it.each([
    [0.333, "⅓"],
    [1.5, "1½"],
    [2, "2"],
    [0.25, "¼"],
    [2.75, "2¾"],
    [0.667, "⅔"],
    [0.125, "⅛"],
    [1.999, "2"],
    [0.45, "0.45"],
    [10, "10"],
  ])("%s -> %s", (n, s) => expect(formatQuantity(n)).toBe(s));
});

describe("unit table", () => {
  it("has unique keys and resolvable names", () => {
    expect(new Set(UNITS.map((u) => u.key)).size).toBe(UNITS.length);
    for (const u of UNITS) for (const n of u.names) expect(findUnit(n)?.key).toBe(u.key);
  });
  it("converts consistently", () => {
    expect(findUnit("tbsp")!.factor / findUnit("tsp")!.factor).toBeCloseTo(3, 5);
    expect(findUnit("cup")!.factor / findUnit("tbsp")!.factor).toBeCloseTo(16, 5);
    expect(findUnit("lb")!.factor / findUnit("oz")!.factor).toBeCloseTo(16, 5);
  });
});
