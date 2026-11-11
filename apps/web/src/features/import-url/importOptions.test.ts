import { expect, it } from "vitest";
import { importSource } from "./importOptions";

it("maps ?from= to a tab and falls back to the link tab", () => {
  expect(importSource(new URLSearchParams("from=text"))).toBe("text");
  expect(importSource(new URLSearchParams("from=photos"))).toBe("photos");
  expect(importSource(new URLSearchParams("from=nope"))).toBe("link");
  expect(importSource(new URLSearchParams(""))).toBe("link");
});
