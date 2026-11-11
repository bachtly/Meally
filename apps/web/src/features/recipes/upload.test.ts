import { expect, it, vi } from "vitest";
import { buildImageForm, fitWithin } from "./upload";

it("fits within the longest side and never enlarges", () => {
  expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  expect(fitWithin(3000, 4000, 800)).toEqual({ width: 600, height: 800 });
  expect(fitWithin(200, 100, 800)).toEqual({ width: 200, height: 100 });
});

it("sends the original when the server resizes, and three WebP parts when it does not", async () => {
  const file = new File(["x"], "a.jpg", { type: "image/jpeg" });
  const plain = await buildImageForm(file, false);
  expect(plain.get("file")).toBeInstanceOf(File);

  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close }));
  const drawn: number[] = [];
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(public width: number) {
        drawn.push(width);
      }
      getContext() {
        return { drawImage() {} };
      }
      async convertToBlob({ type }: { type: string }) {
        return new Blob(["w"], { type });
      }
    },
  );
  const sized = await buildImageForm(file, true);
  expect(["w320", "w800", "w1600"].map((k) => (sized.get(k) as File).type)).toEqual(["image/webp", "image/webp", "image/webp"]);
  expect(sized.get("file")).toBeNull();
  expect(drawn).toEqual([320, 800, 1600]);
  expect(close).toHaveBeenCalled();
  vi.unstubAllGlobals();
});
