/** Browser-side image resizing, so hosts without sharp (the edge) can store ready-made sizes. */
export const IMAGE_SIZES = [320, 800, 1600] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** The server rejects a pre-sized part above 2 MB; stay a little under it. */
export const MAX_PART_BYTES = 1_990_000;

/**
 * Encode quality. These are higher than the usual 0.75–0.8 defaults because photos are the point of
 * a recipe page: at 0.88 (WebP) and 0.9 (JPEG) there is no visible banding or blockiness on food
 * photos, and a 1600 px photo still lands around 200–600 KB.
 */
export const QUALITY = { "image/webp": 0.88, "image/jpeg": 0.9 } as const;
/** Used only when a very detailed 1600 px photo would go over the part limit at full quality. */
const FALLBACK_QUALITY = 0.8;

/** Scale so the longest side is at most `max` (never enlarges). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * The intermediate sizes to draw through so no single step shrinks by more than half. Browsers
 * smooth only from a few neighbouring pixels, so one big jump (4000 → 320 px) skips detail and
 * leaves jagged, shimmering edges. Halving step by step averages every pixel, like a proper resize.
 */
export function downscaleSteps(from: { width: number; height: number }, to: { width: number; height: number }): { width: number; height: number }[] {
  const steps: { width: number; height: number }[] = [];
  let { width, height } = from;
  while (width / 2 > to.width && height / 2 > to.height) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
    steps.push({ width, height });
  }
  steps.push(to);
  return steps;
}

type Source = ImageBitmap | OffscreenCanvas | HTMLCanvasElement;
type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function encode(canvas: Canvas, type: string, quality: number): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality));
}

/** Draws `source` at `width` × `height`, halving through intermediate canvases when the drop is large. */
function drawTo(source: Source, from: { width: number; height: number }, width: number, height: number): Canvas {
  let current: Source = source;
  let canvas: Canvas | undefined;
  for (const step of downscaleSteps(from, { width, height })) {
    canvas = makeCanvas(step.width, step.height);
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Could not draw image");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, step.width, step.height);
    current = canvas;
  }
  return canvas!;
}

let webpSupport: Promise<boolean> | undefined;
/**
 * Whether this browser can encode WebP from a canvas. Safari returns a PNG instead without an error,
 * so the check looks at the blob type. Runs once per page load.
 */
export function canEncodeWebp(): Promise<boolean> {
  webpSupport ??= (async () => {
    // Chromium will not encode a canvas that has no context yet, so draw one pixel first.
    const probe = makeCanvas(1, 1);
    const ctx = probe.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    ctx?.fillRect(0, 0, 1, 1);
    return (await encode(probe, "image/webp", 0.8)).type === "image/webp";
  })().catch(() => false);
  return webpSupport;
}
/** Test hook: forget the cached WebP check. */
export const resetWebpSupport = () => {
  webpSupport = undefined;
};

/** Decodes with EXIF orientation applied, so phone photos come out upright. */
const decode = (file: Blob) => createImageBitmap(file, { imageOrientation: "from-image" });

export interface ResizedImage {
  type: "image/webp" | "image/jpeg";
  sizes: Record<ImageSize, Blob>;
}

/**
 * Makes the 1600, 800 and 320 px versions of a photo: WebP where the browser can encode it, JPEG
 * otherwise (Safari). Work stays flat as photos get bigger. The full-size decode is drawn once, into
 * the largest size, then released. Each smaller size is drawn from the one before it. Sizes that
 * come out the same (a photo under 1600 px) share one encode.
 */
export async function resizeImage(file: File): Promise<ResizedImage> {
  const type = (await canEncodeWebp()) ? "image/webp" : "image/jpeg";
  const bitmap = await decode(file);
  // Read the size now: a closed ImageBitmap reports 0 × 0, and it is closed after the first draw.
  const full = { width: bitmap.width, height: bitmap.height };
  const out = {} as Record<ImageSize, Blob>;
  let source: Source = bitmap;
  let from = full;
  let last: { width: number; height: number; blob: Blob } | undefined;
  try {
    for (const size of [...IMAGE_SIZES].sort((a, b) => b - a)) {
      const { width, height } = fitWithin(full.width, full.height, size);
      if (last && last.width === width && last.height === height) {
        out[size] = last.blob;
        continue;
      }
      const canvas = drawTo(source, from, width, height);
      if (source === bitmap) bitmap.close(); // free the full-size decode as early as possible
      source = canvas;
      from = { width, height };
      let blob = await encode(canvas, type, QUALITY[type]);
      if (blob.size > MAX_PART_BYTES) blob = await encode(canvas, type, FALLBACK_QUALITY);
      if (blob.type !== type) throw new Error(`This browser could not make a ${type === "image/webp" ? "WebP" : "JPEG"} image`);
      if (blob.size > MAX_PART_BYTES) throw new Error("This photo is too detailed to upload; try a smaller one");
      out[size] = blob;
      last = { width, height, blob };
    }
    return { type, sizes: out };
  } finally {
    bitmap.close();
  }
}

/** Keeps an original for the AI helper but caps the longest side at 1600 px (JPEG). */
export async function capImage(file: File, max = 1600): Promise<File> {
  if (typeof createImageBitmap === "undefined") return file;
  try {
    const bitmap = await decode(file);
    try {
      if (Math.max(bitmap.width, bitmap.height) <= max && file.size < 2 * 1024 * 1024) return file;
      const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
      const blob = await encode(drawTo(bitmap, bitmap, width, height), "image/jpeg", 0.85);
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file; // undecodable here (for example HEIC): let the server decide
  }
}

/**
 * Multipart body for an image upload: the three pre-sized parts when the server wants them,
 * otherwise the original under `file`.
 */
export async function buildImageForm(file: File, presized: boolean): Promise<FormData> {
  const body = new FormData();
  if (presized) {
    const { type, sizes } = await resizeImage(file);
    const ext = type === "image/webp" ? "webp" : "jpg";
    for (const size of IMAGE_SIZES) body.append(`w${size}`, sizes[size], `${size}.${ext}`);
  } else body.append("file", file);
  return body;
}
