import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Button, IconButton } from "./Button";
import { Switch } from "./Switch";
import { ThemeToggle } from "./ThemeToggle";

// Touch targets must be at least 44px (CLAUDE.md UI rules). jsdom has no layout, so these
// tests pin the classes the sizes rely on.
afterEach(cleanup);

it("grows a small button to 44px on coarse pointers", () => {
  render(<Button size="sm">Sort</Button>);
  const cls = screen.getByRole("button", { name: "Sort" }).className.split(" ");
  expect(cls).toContain("min-h-9");
  expect(cls).toContain("pointer-coarse:min-h-11");
});

it("keeps an icon button at least 44px on coarse pointers, even when a class shrinks it", () => {
  render(
    <IconButton aria-label="Add" className="!size-8">
      +
    </IconButton>,
  );
  const cls = screen.getByRole("button", { name: "Add" }).className.split(" ");
  expect(cls).toContain("!size-8");
  expect(cls).toContain("pointer-coarse:min-h-11");
  expect(cls).toContain("pointer-coarse:min-w-11");
});

it("gives the switch a 44px tall hit area without changing the track", () => {
  render(<Switch aria-label="Meal planner" />);
  const cls = screen.getByRole("switch", { name: "Meal planner" }).className.split(" ");
  expect(cls).toEqual(expect.arrayContaining(["relative", "h-7", "w-12", "after:absolute", "after:-inset-y-2.5"]));
});

it("makes each theme segment 44px tall", () => {
  render(<ThemeToggle />);
  for (const name of ["Light", "Dark", "System"]) {
    expect(screen.getByRole("button", { name }).className.split(" ")).toContain("min-h-11");
  }
});
