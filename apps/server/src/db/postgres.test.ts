import { describe, expect, it } from "vitest";
import { EDGE_PG_OPTIONS } from "./postgres.js";

describe("edge postgres options", () => {
  it("closes idle connections and times out connects, so a dropped socket can't hang requests", () => {
    expect(EDGE_PG_OPTIONS.prepare).toBe(false);
    expect(EDGE_PG_OPTIONS.idle_timeout).toBeGreaterThan(0);
    expect(EDGE_PG_OPTIONS.idle_timeout).toBeLessThanOrEqual(30);
    expect(EDGE_PG_OPTIONS.max_lifetime).toBeGreaterThan(0);
    expect(EDGE_PG_OPTIONS.connect_timeout).toBeLessThanOrEqual(15);
  });
});
