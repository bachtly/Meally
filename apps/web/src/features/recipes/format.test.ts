import { expect, it } from "vitest";
import { imageSrcSet } from "./format";

it("points at the sized copies of a stored image", () => {
  expect(imageSrcSet("/api/v1/images/abc/800")).toBe("/api/v1/images/abc/320 320w, /api/v1/images/abc/800 800w");
});

it("has no srcset for a missing, data: or blob: image", () => {
  expect(imageSrcSet(null)).toBeUndefined();
  expect(imageSrcSet("data:image/svg+xml;utf8,%3Csvg%2F%3E")).toBeUndefined();
  expect(imageSrcSet("blob:http://localhost/1234")).toBeUndefined();
});
