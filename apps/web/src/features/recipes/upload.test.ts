import { afterEach, expect, it, vi } from "vitest";
import { MAX_PART_BYTES, QUALITY, buildImageForm, downscaleSteps, fitWithin, resetWebpSupport } from "./upload";

it("fits within the longest side and never enlarges", () => {
  expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  expect(fitWithin(3000, 4000, 800)).toEqual({ width: 600, height: 800 });
  expect(fitWithin(200, 100, 800)).toEqual({ width: 200, height: 100 });
});

it("never shrinks by more than half in one step", () => {
  expect(downscaleSteps({ width: 4000, height: 3000 }, { width: 1600, height: 1200 })).toEqual([
    { width: 2000, height: 1500 },
    { width: 1600, height: 1200 },
  ]);
  expect(downscaleSteps({ width: 1600, height: 1200 }, { width: 800, height: 600 })).toEqual([{ width: 800, height: 600 }]);
  expect(downscaleSteps({ width: 8000, height: 6000 }, { width: 320, height: 240 }).map((s) => s.width)).toEqual([4000, 2000, 1000, 500, 320]);
});

interface Encoded {
  width: number;
  type: string;
  quality: number;
}

/** Fake canvas: encodes WebP or not (Safari falls back to PNG), and reports sizes via `bytes`. */
function stubCanvas(opts: { webp: boolean; bytes?: (e: Encoded) => number; photo?: { width: number; height: number } }) {
  const close = vi.fn();
  const photo = opts.photo ?? { width: 4000, height: 3000 };
  vi.stubGlobal("createImageBitmap", async () => ({ ...photo, close }));
  const drawn: number[] = [];
  const encoded: Encoded[] = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {
        if (width > 1) drawn.push(width);
      }
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob({ type, quality }: { type: string; quality: number }) {
        const out = type === "image/webp" && !opts.webp ? "image/png" : type;
        const e = { width: this.width, type: out, quality };
        if (this.width > 1) encoded.push(e);
        return new Blob([new Uint8Array(opts.bytes?.(e) ?? 1)], { type: out });
      }
    },
  );
  return { close, drawn, encoded };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetWebpSupport();
});

it("sends the original when the server resizes", async () => {
  const plain = await buildImageForm(new File(["x"], "a.jpg", { type: "image/jpeg" }), false);
  expect(plain.get("file")).toBeInstanceOf(File);
});

it("makes three WebP parts at high quality, halving large drops", async () => {
  const { close, drawn, encoded } = stubCanvas({ webp: true });
  const sized = await buildImageForm(new File(["x"], "a.jpg", { type: "image/jpeg" }), true);
  expect(["w320", "w800", "w1600"].map((k) => (sized.get(k) as File).type)).toEqual(["image/webp", "image/webp", "image/webp"]);
  expect((sized.get("w1600") as File).name).toBe("1600.webp");
  expect(sized.get("file")).toBeNull();
  // 4000 → 2000 → 1600, then 1600 → 800, then 800 → 400 → 320.
  expect(drawn).toEqual([2000, 1600, 800, 400, 320]);
  expect(encoded.map((e) => [e.width, e.quality])).toEqual([
    [1600, QUALITY["image/webp"]],
    [800, QUALITY["image/webp"]],
    [320, QUALITY["image/webp"]],
  ]);
  expect(close).toHaveBeenCalled();
});

it("falls back to JPEG where the browser cannot encode WebP (Safari)", async () => {
  const { encoded } = stubCanvas({ webp: false });
  const sized = await buildImageForm(new File(["x"], "a.heic", { type: "image/heic" }), true);
  expect(["w320", "w800", "w1600"].map((k) => (sized.get(k) as File).type)).toEqual(["image/jpeg", "image/jpeg", "image/jpeg"]);
  expect((sized.get("w800") as File).name).toBe("800.jpg");
  expect(encoded.every((e) => e.type === "image/jpeg" && e.quality === QUALITY["image/jpeg"])).toBe(true);
});

it("encodes a small photo once for the sizes it already fits", async () => {
  const { encoded } = stubCanvas({ webp: false, photo: { width: 672, height: 456 } });
  const sized = await buildImageForm(new File(["x"], "ribs.jpg", { type: "image/jpeg" }), true);
  expect(encoded.map((e) => e.width)).toEqual([672, 320]);
  expect(sized.get("w1600")).toBeInstanceOf(File);
  expect(sized.get("w800")).toBeInstanceOf(File);
});

it("lowers quality only for a part that would go over the size limit", async () => {
  const { encoded } = stubCanvas({ webp: true, bytes: (e) => (e.width === 1600 && e.quality > 0.85 ? MAX_PART_BYTES + 1 : 10) });
  await buildImageForm(new File(["x"], "a.jpg", { type: "image/jpeg" }), true);
  expect(encoded.map((e) => [e.width, e.quality])).toEqual([
    [1600, QUALITY["image/webp"]],
    [1600, 0.8],
    [800, QUALITY["image/webp"]],
    [320, QUALITY["image/webp"]],
  ]);
});
