import { cleanup, render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import * as matchers from "vitest-axe/matchers";
import { afterEach, expect, it } from "vitest";
import { NutritionCard } from "./NutritionCard";
import { buildInput, initialForm } from "./editorModel";

expect.extend(matchers);
afterEach(cleanup);

const n = { calories: 240, proteinG: 12.5, carbsG: null, fatG: 8, saturatedFatG: null, fibreG: null, sugarG: null, sodiumMg: 480, source: "Label" };

it("renders per serving and a total that follows servings", async () => {
  const { container, rerender } = render(<NutritionCard nutrition={n} servings={4} />);
  expect(screen.getByText("240 kcal")).toBeInTheDocument();
  expect(screen.getByText("960 kcal")).toBeInTheDocument();
  expect(screen.getByText("Total for 4")).toBeInTheDocument();
  expect(screen.queryByText("Carbohydrate")).toBeNull();
  expect(screen.getByText("Source: Label")).toBeInTheDocument();
  expect(await axe(container)).toHaveNoViolations();
  rerender(<NutritionCard nutrition={n} servings={2} />);
  expect(screen.getByText("480 kcal", { selector: "td" })).toBeInTheDocument();
});

it("hides the total without servings", () => {
  render(<NutritionCard nutrition={n} servings={null} />);
  expect(screen.queryByText(/Total for/)).toBeNull();
});

it("editor model builds nutrition only when on, and validates", () => {
  const f = initialForm();
  f.name = "X";
  f.nutrition.calories = "100";
  expect(buildInput(f, false, false).input).not.toHaveProperty("nutrition");
  expect(buildInput(f, false, true).input?.nutrition).toMatchObject({ calories: 100, proteinG: null });
  f.nutrition.calories = "";
  expect(buildInput(f, false, true).input?.nutrition).toBeNull();
  f.nutrition.fatG = "-2";
  expect(buildInput(f, false, true).errors.nutrition).toMatch(/Total fat/);
});
