import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractRecipe, parseDuration } from "./extract.js";

const fx = (n: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", n), "utf8");
const U = "https://example.com/r";

describe("parseDuration", () => {
  it.each([
    ["PT15M", 15],
    ["PT1H30M", 90],
    ["P1DT2H", 1560],
    ["PT90S", 2],
    ["PT1,5H", 90],
    ["P1W", 10080],
  ])("%s", (v, n) => expect(parseDuration(v)).toBe(n));
  it("rejects junk", () => {
    for (const v of ["", "P", "PT", "15 min", null, 5]) expect(parseDuration(v)).toBeNull();
  });
});

describe("extractRecipe", () => {
  it("reads JSON-LD inside @graph with an array type", () => {
    const r = extractRecipe(fx("graph.html"), U)!;
    expect(r.recipe.name).toBe("Tomato & Basil Soup");
    expect(r.recipe.description).toBe("A simple soup.");
    expect(r.imageUrl).toBe("https://img.example.com/big.jpg");
    expect(r.recipe.servings).toBe(4);
    expect([r.recipe.prepMinutes, r.recipe.cookMinutes, r.recipe.totalMinutes]).toEqual([15, 60, 75]);
    expect(r.recipe.ingredients![0]).toMatchObject({ quantity: 2, raw: "2 cups chopped tomatoes" });
    expect(r.recipe.steps![1]!.text).toBe("Simmer for 30 minutes.");
    expect(r.keywords).toEqual(["soup", "vegan", "quick"]);
    expect(r.categories).toEqual(["Dinner"]);
    expect(r.recipe.sourceUrl).toBe(U);
  });
  it("handles a top-level array and string instructions", () => {
    const r = extractRecipe(fx("array-type.html"), U)!;
    expect(r.recipe.name).toBe("Oat Cookies");
    expect(r.recipe.yieldText).toBe("12 cookies");
    expect(r.recipe.steps!.map((s) => s.text)).toEqual(["Mix everything.", "Bake until golden."]);
  });
  it("turns HowToSection into step sections (via mainEntity)", () => {
    const r = extractRecipe(fx("sections.html"), U)!;
    expect(r.recipe.steps!.map((s) => [s.section, s.text])).toEqual([
      ["Cake", "Whisk eggs."],
      ["Cake", "Bake."],
      ["Icing", "Beat butter."],
    ]);
  });
  it("falls back to microdata", () => {
    const r = extractRecipe(fx("microdata.html"), U)!;
    expect(r.recipe.name).toBe("Garlic Toast");
    expect(r.imageUrl).toBe("https://example.com/toast.jpg");
    expect([r.recipe.prepMinutes, r.recipe.cookMinutes]).toEqual([5, 10]);
    expect(r.recipe.ingredients).toHaveLength(2);
    expect(r.recipe.steps!.map((s) => s.text)).toEqual(["Toast the bread.", "Rub with garlic."]);
  });
  it("returns null when there is no recipe", () => {
    expect(extractRecipe(fx("none.html"), U)).toBeNull();
  });
});
