import { describe, expect, it } from "vitest";
import { nutritionFromSchemaOrg, parseAmount } from "./nutrition.js";
import { recipeFromNode } from "./extract.js";

describe("parseAmount", () => {
  it.each([
    ["240 kcal", "kcal", 240],
    ["240", "kcal", 240],
    ["240 calories", "kcal", 240],
    ["1000 kJ", "kcal", 239],
    ["12 g", "g", 12],
    ["12g", "g", 12],
    ["1,5 g", "g", 1.5],
    ["0.5 grams", "g", 0.5],
    ["500 mg", "mg", 500],
    ["0.5 g", "mg", 500],
    ["2 g", "mg", 2000],
    ["800 mg", "g", 0.8],
    [12, "g", 12],
    ["12.5 g.", "g", 12.5],
  ] as const)("%s as %s", (v, t, n) => expect(parseAmount(v, t)).toBe(n));
  it.each([["", "g"], ["lots", "g"], ["12 parsecs", "g"], [null, "g"], [-3, "g"], ["12 g", "kcal"], [{}, "mg"]] as const)(
    "rejects %s",
    (v, t) => expect(parseAmount(v, t)).toBeNull(),
  );
});

describe("nutritionFromSchemaOrg", () => {
  it("maps a full node", () => {
    const n = nutritionFromSchemaOrg({
      "@type": "NutritionInformation",
      calories: "240 kcal",
      proteinContent: "12 g",
      carbohydrateContent: "30 g",
      fatContent: "8 g",
      saturatedFatContent: "2 g",
      fiberContent: "4 g",
      sugarContent: "6 g",
      sodiumContent: "480 mg",
    });
    expect(n).toMatchObject({ calories: 240, proteinG: 12, carbsG: 30, fatG: 8, saturatedFatG: 2, fibreG: 4, sugarG: 6, sodiumMg: 480 });
  });
  it("keeps partial data and drops junk fields", () => {
    expect(nutritionFromSchemaOrg({ calories: "100 kcal", fatContent: "n/a" })).toMatchObject({ calories: 100, fatG: null });
  });
  it("returns null when nothing is usable", () => {
    expect(nutritionFromSchemaOrg({ servingSize: "1 cup" })).toBeNull();
    expect(nutritionFromSchemaOrg("x")).toBeNull();
    expect(nutritionFromSchemaOrg([])).toBeNull();
  });
  it("is mapped by the recipe mapper", () => {
    const r = recipeFromNode({ name: "Soup", recipeIngredient: ["1 onion"], nutrition: { calories: "90 kcal" } }, null);
    expect(r?.recipe.nutrition?.calories).toBe(90);
    expect(recipeFromNode({ name: "Soup", recipeIngredient: ["1 onion"] }, null)?.recipe.nutrition).toBeUndefined();
  });
});

describe("JSON-LD export round trip", () => {
  it("writes NutritionInformation that the importer reads back", async () => {
    const { toJsonLd } = await import("../backups/export.js");
    const base = { id: "1", slug: "s", name: "Soup", imageUrl: null, ingredients: [{ raw: "1 onion", position: 0, section: null, quantity: null, unit: null, food: null, note: null }], steps: [], createdAt: 0, updatedAt: 0 } as any;
    const node = toJsonLd({ ...base, nutrition: { calories: 240, proteinG: 12, carbsG: null, fatG: null, saturatedFatG: null, fibreG: null, sugarG: null, sodiumMg: 480, source: null } }, null);
    expect(node.nutrition).toMatchObject({ "@type": "NutritionInformation", calories: "240 kcal", sodiumContent: "480 mg" });
    expect(recipeFromNode(node, null)?.recipe.nutrition).toMatchObject({ calories: 240, proteinG: 12, sodiumMg: 480 });
    expect(toJsonLd({ ...base, nutrition: null }, null).nutrition).toBeUndefined();
  });
});
