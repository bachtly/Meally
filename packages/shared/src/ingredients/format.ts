const FRACS: Array<[number, string]> = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/** Render a quantity with nice fractions: 0.333 -> "⅓", 1.5 -> "1½". Falls back to up to 2 decimals. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  if (frac > 0.98) return String(whole + 1);
  for (const [v, s] of FRACS) {
    if (Math.abs(frac - v) < 0.02) return whole > 0 ? `${whole}${s}` : s;
  }
  return String(Math.round(n * 100) / 100);
}
