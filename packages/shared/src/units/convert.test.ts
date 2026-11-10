import { describe, expect, it } from "vitest";
import {
  canConvert,
  convertQuantity,
  friendlyAmount,
  mergeQuantities,
} from "./convert.js";

describe("convertQuantity", () => {
  it.each([
    [1, "cup", "ml", 236.588],
    [3, "tsp", "tbsp", 1],
    [1, "kg", "g", 1000],
    [1, "lb", "oz", 16],
    [2, "can", "can", 2],
  ])("%s %s -> %s", (q, f, t, out) =>
    expect(convertQuantity(q, f, t)).toBeCloseTo(out, 2),
  );
  it.each([
    ["cup", "g"],
    ["can", "jar"],
    ["g", null],
    [null, "cup"],
  ])("%s !-> %s", (f, t) => {
    expect(canConvert(f, t)).toBe(false);
    expect(convertQuantity(1, f, t)).toBeNull();
  });
  it("null to null is fine", () =>
    expect(convertQuantity(2, null, null)).toBe(2));
});

describe("friendlyAmount", () => {
  it.each([
    [1500, "ml", 1.5, "l"],
    [0.5, "l", 500, "ml"],
    [48, "tsp", 1, "cup"],
    [3, "tbsp", 3, "tbsp"],
    [20, "oz", 1.25, "lb"],
    [2, "can", 2, "can"],
    [3, null, 3, null],
  ])("%s %s", (q, u, oq, ou) =>
    expect(friendlyAmount(q, u)).toEqual({ quantity: oq, unit: ou }),
  );
});

describe("mergeQuantities", () => {
  const m = (
    a: [number | null, string | null],
    b: [number | null, string | null],
  ) =>
    mergeQuantities(
      { quantity: a[0], unit: a[1] },
      { quantity: b[0], unit: b[1] },
    );
  it("same unit", () =>
    expect(m([2, "tbsp"], [1, "tbsp"])).toEqual({ quantity: 3, unit: "tbsp" }));
  it("counts", () =>
    expect(m([2, null], [1, null])).toEqual({ quantity: 3, unit: null }));
  it("cup + ml keeps the first system", () => {
    const r = m([1, "cup"], [250, "ml"])!;
    expect(r.unit).toBe("cup");
    expect(r.quantity).toBeCloseTo(2.057, 2);
  });
  it("upgrades unit", () =>
    expect(m([500, "g"], [700, "g"])).toEqual({ quantity: 1.2, unit: "kg" }));
  it("incompatible", () => {
    expect(m([1, "cup"], [100, "g"])).toBeNull();
    expect(m([1, "can"], [1, null])).toBeNull();
    expect(m([null, null], [1, null])).toBeNull();
  });
  it("both unquantified", () =>
    expect(m([null, null], [null, null])).toEqual({
      quantity: null,
      unit: null,
    }));
});
