import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { applyTheme, readTheme, ThemeToggle } from "./ThemeToggle";

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

it("is dark by default, without saving the default", () => {
  expect(readTheme()).toBe("dark");
  applyTheme(readTheme(), false);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("meally-theme")).toBeNull();
});

it("remembers light, dark and system once picked", async () => {
  render(<ThemeToggle />);
  expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "System" }));
  expect(readTheme()).toBe("system");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  await userEvent.click(screen.getByRole("button", { name: "Light" }));
  expect(readTheme()).toBe("light");
  expect(document.documentElement.dataset.theme).toBe("light");
});
