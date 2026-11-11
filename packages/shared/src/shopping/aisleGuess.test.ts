import { describe, expect, it } from "vitest";
import { guessAisle } from "./aisleGuess.js";

describe("guessAisle", () => {
  it.each([
    ["onion", "Produce"],
    ["halloumi", "Dairy & eggs"],
    ["Tomatoes", "Produce"],
    ["strawberries", "Produce"],
    ["red onions", "Produce"],
    ["milk", "Dairy & eggs"],
    ["eggs", "Dairy & eggs"],
    ["sour cream", "Dairy & eggs"],
    ["ice cream", "Frozen"],
    ["chicken thighs", "Meat & fish"],
    ["salmon fillet", "Meat & fish"],
    ["olive oil", "Pantry"],
    ["flour", "Pantry"],
    ["black pepper", "Spices"],
    ["sourdough bread", "Bakery"],
    ["orange juice", "Drinks"],
    ["paper towels", "Household"],
    ["unobtainium", null],
    [null, null],
  ])("%s -> %s", (food, aisle) => {
    expect(guessAisle(food)).toBe(aisle);
  });
});
