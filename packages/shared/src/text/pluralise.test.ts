import { describe, expect, it } from "vitest";
import { pluralise } from "./pluralise.js";

describe("pluralise", () => {
  it.each([
    ["onion", "onions"], ["red onion", "red onions"], ["peach", "peaches"], ["box", "boxes"], ["cherry", "cherries"],
    ["day", "days"], ["tomato", "tomatoes"], ["avocado", "avocados"], ["leaf", "leaves"], ["glass", "glasses"],
    ["garlic", "garlic"], ["rice", "rice"], ["flour", "flour"], ["eggs", "eggs"], ["tomatoes", "tomatoes"],
    ["asparagus", "asparagus"], ["chicken breast", "chicken breasts"], ["cream of tartar", "cream of tartar"], ["", ""],
  ])("%s -> %s", (a, b) => expect(pluralise(a)).toBe(b));
});
