/** Browser-side image resizing, so hosts without sharp (the edge) can store ready-made WebP sizes. */
export const IMAGE_SIZES = [320, 800, 1600] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

/** Scale so the longest side is at most `max` (never enlarges). */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

async function draw(bitmap: ImageBitmap, max: number, type: string, quality: number): Promise<Blob> {
  const { width, height } = fitWithin(bitmap.width, bitmap.height, max);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
    return canvas.convertToBlob({ type, quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode image"))), type, quality));
}

/** Decodes with EXIF orientation applied, so phone photos come out upright. */
const decode = (file: Blob) => createImageBitmap(file, { imageOrientation: "from-image" });

/** Makes the 320, 800 and 1600 px WebP versions of a photo. */
export async function resizeToWebp(file: File): Promise<Record<ImageSize, Blob>> {
  const bitmap = await decode(file);
  try {
    const out = {} as Record<ImageSize, Blob>;
    for (const size of IMAGE_SIZES) {
      const blob = await draw(bitmap, size, "image/webp", 0.8);
      if (blob.type !== "image/webp") throw new Error("This browser cannot make WebP images");
      out[size] = blob;
    }
    return out;
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
      const blob = await draw(bitmap, max, "image/jpeg", 0.85);
      return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
    } finally {
      bitmap.close();
    }
  } catch {
    return file; // undecodable here (for example HEIC): let the server decide
  }
}

/**
 * Multipart body for an image upload: the three pre-sized WebP parts when the server wants them,
 * otherwise the original under `file`.
 */
export async function buildImageForm(file: File, presized: boolean): Promise<FormData> {
  const body = new FormData();
  if (presized) {
    const sizes = await resizeToWebp(file);
    for (const size of IMAGE_SIZES) body.append(`w${size}`, sizes[size], `${size}.webp`);
  } else body.append("file", file);
  return body;
}
