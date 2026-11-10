export function formatMinutes(m: number | null | undefined): string | null {
  if (m == null) return null;
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** Image URLs end in a size; build a srcset from the given sizes. */
export function imageSrcSet(url: string | null, sizes: number[] = [320, 800]): string | undefined {
  if (!url) return undefined;
  const base = url.replace(/\/\d+$/, "");
  return sizes.map((s) => `${base}/${s} ${s}w`).join(", ");
}

export function hostname(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A stable warm hue (20-90 degrees) derived from a name, for photo-less cards. */
export function warmHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 20 + (h % 71);
}
