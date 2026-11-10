import { describe, expect, it } from "vitest";
import { adjustIngredient, convertIngredient, formatIngredient, scaleIngredient, type ScalableIngredient } from "./scale.js";

const ing = (quantity: number | null, unit: string | null, food: string | null, extra: Partial<ScalableIngredient> = {}): ScalableIngredient => ({
  quantity,
  unit,
  food,
  note: null,
  raw: food ?? "raw line",
  ...extra,
});

describe("scaleIngredient", () => {
  it.each([
    [ing(1, "cup", "flour"), 2, "2 cups flour"],
    [ing(1, "cup", "flour"), 0.5, "½ cup flour"],
    [ing(1, "cup", "flour"), 1 / 3, "⅓ cup flour"],
    [ing(16, "tbsp", "oil"), 2, "2 cups oil"],
    [ing(12, "tsp", "sugar"), 4, "1 cup sugar"],
    [ing(1, "tsp", "salt"), 3, "1 tbsp salt"],
    [ing(1, "tbsp", "honey"), 0.5, "1½ tsp honey"],
    [ing(500, "g", "rice"), 2, "1 kg rice"],
    [ing(500, "g", "rice"), 1.5, "750 g rice"],
    [ing(1, "kg", "potatoes"), 0.5, "500 g potatoes"],
    [ing(250, "ml", "milk"), 4, "1 l milk"],
    [ing(1, "l", "stock"), 0.25, "250 ml stock"],
    [ing(8, "oz", "cheese"), 2, "1 lb cheese"],
    [ing(1, "lb", "beef"), 0.5, "8 oz beef"],
    [ing(4, "cup", "water"), 4, "1 gallon water"],
    [ing(2, "clove", "garlic"), 2, "4 cloves garlic"],
    [ing(2, "clove", "garlic"), 0.5, "1 clove garlic"],
    [ing(1, "can", "tomatoes"), 3, "3 cans tomatoes"],
    [ing(1, null, "onion"), 3, "3 onions"],
    [ing(2, "pint", "cream"), 2, "4 pints cream"],
    [ing(2, "tbsp", "butter", { note: "melted" }), 2, "¼ cup butter, melted"],
  ])("%j x%s", (i, f, out) => expect(scaleIngredient(i, f).raw).toBe(out));

  it("scales ranges at both ends", () => {
    const r = scaleIngredient(ing(1, "cup", "stock", { quantityMax: 1.5 }), 2);
    expect([r.quantity, r.quantityMax, r.unit]).toEqual([2, 3, "cup"]);
    expect(r.raw).toBe("2–3 cups stock");
  });
  it("leaves unparsed lines and factor 1 untouched", () => {
    const line = ing(null, null, null, { raw: "salt to taste" });
    expect(scaleIngredient(line, 3)).toBe(line);
    const same = ing(1, "cup", "flour");
    expect(scaleIngredient(same, 1)).toBe(same);
  });
  it("keeps raw text when there is no food to rebuild from", () => {
    const x = ing(2, "cup", null, { raw: "2 cups of something" });
    expect(scaleIngredient(x, 2).raw).toBe("2 cups of something");
  });
});

describe("convertIngredient", () => {
  it.each([
    [ing(1, "cup", "milk"), "metric", "235 ml milk"],
    [ing(1, "tsp", "salt"), "metric", "5 ml salt"],
    [ing(0.5, "tsp", "salt"), "metric", "2.5 ml salt"],
    [ing(1, "tbsp", "oil"), "metric", "15 ml oil"],
    [ing(0.25, "cup", "oil"), "metric", "60 ml oil"],
    [ing(1, "gallon", "water"), "metric", "3.79 l water"],
    [ing(1, "oz", "cheese"), "metric", "28 g cheese"],
    [ing(1, "lb", "beef"), "metric", "455 g beef"],
    [ing(4, "lb", "pork"), "metric", "1.81 kg pork"],
    [ing(250, "ml", "milk"), "us", "1 cup milk"],
    [ing(15, "ml", "oil"), "us", "1 tbsp oil"],
    [ing(5, "ml", "vanilla"), "us", "1 tsp vanilla"],
    [ing(120, "ml", "cream"), "us", "½ cup cream"],
    [ing(100, "g", "flour"), "us", "3½ oz flour"],
    [ing(1, "kg", "flour"), "us", "2¼ lb flour"],
    [ing(500, "g", "rice"), "us", "1 lb rice"],
    [ing(1, "cup", "milk"), "us", "1 cup milk"],
    [ing(500, "g", "rice"), "metric", "500 g rice"],
    [ing(1000, "g", "rice"), "metric", "1 kg rice"],
    [ing(1500, "ml", "stock"), "metric", "1.5 l stock"],
    
    [ing(2, "clove", "garlic"), "metric", "2 cloves garlic"],
    [ing(3, null, "eggs"), "us", "3 eggs"],
  ])("%j to %s", (i, sys, out) => expect(convertIngredient(i, sys as "metric" | "us" | "original").raw).toBe(out));

  it("converts ranges at both ends", () => {
    const r = convertIngredient(ing(1, "cup", "milk", { quantityMax: 2 }), "metric");
    expect([r.quantity, r.quantityMax, r.unit]).toEqual([235, 475, "ml"]);
  });
  it("returns the same object for original and for lines with no quantity", () => {
    const a = ing(1, "cup", "milk");
    expect(convertIngredient(a, "original")).toBe(a);
    const b = ing(null, null, null, { raw: "to taste" });
    expect(convertIngredient(b, "metric")).toBe(b);
  });
});

describe("adjustIngredient", () => {
  it("scales then converts in one step", () => {
    expect(adjustIngredient(ing(1, "cup", "milk"), 6, "metric").raw).toBe("1.42 l milk");
    expect(adjustIngredient(ing(100, "g", "flour"), 3, "us").raw).toBe("11 oz flour");
  });
});

describe("formatIngredient", () => {
  it("uses singular for one and fractions for US units", () => {
    expect(formatIngredient(ing(1.5, "cup", "milk"))).toBe("1½ cups milk");
    expect(formatIngredient(ing(1, "tbsp", "oil"))).toBe("1 tbsp oil");
  });
  it("uses decimals for metric units", () => {
    expect(formatIngredient(ing(2.5, "ml", "vanilla"))).toBe("2.5 ml vanilla");
  });
});

describe("display polish", () => {
  it.each([
    [ing(1, null, "onion"), 2, "2 onions"],
    [ing(2, null, "onions"), 2, "4 onions"],
    [ing(1, null, "onion"), 1.5, "1½ onions"],
    [ing(1, "clove", "garlic"), 3, "3 cloves garlic"],
    [ing(1, "cup", "flour"), 2, "2 cups flour"],
  ])("pluralises %j x%s", (i, f, out) => expect(scaleIngredient(i, f).raw).toBe(out));

  it("keeps the stored food untouched", () => {
    expect(scaleIngredient(ing(1, null, "onion"), 2).food).toBe("onion");
  });

  it.each([
    [ing(85, "g", "cheese"), "3 oz cheese"],
    [ing(120, "g", "cheese"), "4 oz cheese"],
    [ing(150, "g", "cheese"), "5½ oz cheese"],
    [ing(250, "g", "cheese"), "9 oz cheese"],
    [ing(1.1, "kg", "beef"), "2½ lb beef"],
    [ing(300, "g", "beef"), "11 oz beef"],
  ])("rounds US mass coarsely %j", (i, out) => expect(convertIngredient(i, "us").raw).toBe(out));
});
