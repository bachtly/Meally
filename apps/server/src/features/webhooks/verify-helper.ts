import { createHmac, timingSafeEqual } from "node:crypto";

/** Port of the Node snippet in docs/design/features/webhooks.md, used to test the documented behaviour. */
export function verifyWebhook(rawBody: string, header: string | undefined, secret: string, nowSeconds: number, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || !parts.v1 || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const got = Buffer.from(parts.v1);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
