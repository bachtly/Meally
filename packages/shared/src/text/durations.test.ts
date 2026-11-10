import { describe, expect, it } from "vitest";
import { formatClock, parseDurations } from "./durations.js";

const secs = (t: string) => parseDurations(t).map((d) => d.seconds);

describe("parseDurations", () => {
  it.each([
    ["Simmer for 10 minutes.", [600]],
    ["Bake 1 hour", [3600]],
    ["Bake 2 hours", [7200]],
    ["Rest 30 sec", [30]],
    ["Rest 45 seconds", [45]],
    ["Cook 15 mins", [900]],
    ["Cook 1 min", [60]],
    ["Cook 1 hr 20 min", [4800]],
    ["Cook 1 hour and 20 minutes", [4800]],
    ["Cook 1 hour, 15 minutes", [4500]],
    ["Cook 1h30m", [5400]],
    ["Fry 30s", [30]],
    ["Boil 1 1/2 hours", [5400]],
    ["Boil 1½ hours", [5400]],
    ["Boil ½ hour", [1800]],
    ["Boil 1/2 hour", [1800]],
    ["Boil 2.5 hours", [9000]],
    ["Boil 0.5 min", [30]],
    ["Cook 5-7 min", [300]],
    ["Cook 5–7 minutes", [300]],
    ["Cook 5 to 7 minutes", [300]],
    ["Bake 1-2 hours", [3600]],
    ["Simmer 10 minutes, then rest 5 minutes", [600, 300]],
    ["Boil 8 min then chill 2 hr", [480, 7200]],
    ["Add 2 tbsp oil and stir", []],
    ["Heat the oven to 200 degrees", []],
    ["Add 3 eggs", []],
    ["Serve with 4 mushrooms", []],
    ["Cook 0 minutes", []],
    ["No numbers here", []],
    ["Cook for 20 minutes or until golden", [1200]],
    ["Cook 5 m", []],
    ["Version 1.2.3 minutes", []],
  ] as const)("%s", (text, expected) => {
    expect(secs(text)).toEqual(expected);
  });

  it("reports ranges and positions", () => {
    const text = "Cook 5-7 min until soft.";
    const [d] = parseDurations(text);
    expect(d).toMatchObject({ text: "5-7 min", seconds: 300, maxSeconds: 420 });
    expect(text.slice(d!.start, d!.end)).toBe("5-7 min");
  });

  it("joins compound times into one match", () => {
    const [d] = parseDurations("Bake 1 hr 20 min.");
    expect(d!.text).toBe("1 hr 20 min");
  });

  it("does not join a range into a compound", () => {
    expect(secs("Rest 1-2 hours 10 min")).toEqual([3600, 600]);
  });
});

describe("formatClock", () => {
  it("formats", () => {
    expect(formatClock(65)).toBe("01:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-3)).toBe("00:00");
    expect(formatClock(0.2)).toBe("00:01");
  });
});
