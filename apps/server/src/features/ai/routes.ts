import { Hono, type Context, type MiddlewareHandler } from "hono";
import { parseIngredient, recipeInputSchema, unitByKey, z, type ParsedIngredient } from "@meally/shared";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { requireAuth } from "../auth/middleware.js";
import { requireFeature } from "../features/middleware.js";
import { completeJson, loadAiConfig, requireAiConfig, type AiImage } from "./client.js";

const SHAPE = `{"name": string, "description": string|null, "yieldText": string|null, "servings": number|null,
"prepMinutes": integer|null, "cookMinutes": integer|null, "totalMinutes": integer|null, "notes": string|null,
"ingredients": [{"section": string|null, "quantity": number|null, "unit": string|null, "food": string|null, "note": string|null, "raw": string}],
"steps": [{"section": string|null, "text": string}]}`;

const RECIPE_SYSTEM = `You turn recipe material into one JSON object and reply with only that JSON, no prose and no code fences.
Shape: ${SHAPE}
"raw" is the ingredient line as written. Use only what the source says; never invent quantities, steps or times. Leave unknown fields null. Do not include a source URL.`;

const MAX_TEXT = 30_000;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export const aiRoutes = new Hono<AppEnv>();
aiRoutes.use("*", requireAuth, requireFeature("ai"));

aiRoutes.get("/status", (c) => {
  const config = loadAiConfig(c.get("env"));
  return c.json(config ? { configured: true, provider: config.provider, model: config.model } : { configured: false });
});

const limit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const r = c.get("aiLimiter").hit(c.get("user").id);
  if (!r.ok) {
    c.header("Retry-After", String(r.retryAfterSec));
    throw new ApiError(429, "rate_limited", "Too many AI requests. Try again later.");
  }
  await next();
};

async function recipePreview(c: Context<AppEnv>, user: string, images?: AiImage[]) {
  const config = requireAiConfig(c.get("env"));
  const recipe = await completeJson(config, c.get("aiFetch"), recipeInputSchema, { system: RECIPE_SYSTEM, user, images });
  return c.json({ recipe, imageUrl: null });
}

aiRoutes.post("/recipe-from-text", limit, async (c) => {
  const p = z.object({ text: z.string().trim().min(1).max(MAX_TEXT) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "invalid_body", `text: expected 1 to ${MAX_TEXT} characters`);
  return recipePreview(c, `Extract the recipe from this text:\n\n${p.data.text}`);
});

aiRoutes.post("/recipe-from-image", limit, async (c) => {
  if (!/^multipart\/form-data/i.test(c.req.header("content-type") ?? "")) throw new ApiError(400, "invalid_body", "Send the photos as multipart form data");
  if (Number(c.req.header("content-length")) > MAX_IMAGES * MAX_IMAGE_BYTES + 1024 * 1024) throw new ApiError(413, "too_large", "Those photos are too large");
  const form = await c.req.formData().catch(() => null);
  const files = (form ? [...form.values()] : []).filter((v): v is File => typeof v !== "string");
  if (!files.length || files.length > MAX_IMAGES) throw new ApiError(400, "invalid_body", `Send 1 to ${MAX_IMAGES} photos`);
  const images: AiImage[] = [];
  for (const f of files) {
    if (!IMAGE_TYPES.includes(f.type)) throw new ApiError(400, "invalid_body", "Photos must be JPEG, PNG, WebP or GIF");
    if (f.size > MAX_IMAGE_BYTES) throw new ApiError(413, "too_large", "Each photo must be under 8 MB");
    images.push({ mediaType: f.type, base64: Buffer.from(await f.arrayBuffer()).toString("base64") });
  }
  return recipePreview(c, "Extract the recipe shown in the attached photo(s) of a cookbook page or handwritten card. Multiple photos are consecutive parts of one recipe.", images);
});

const llmIngredients = z.object({
  items: z.array(
    z.object({
      index: z.number().int(),
      quantity: z.number().min(0).max(1_000_000).nullish(),
      unit: z.string().max(60).nullish(),
      food: z.string().max(200).nullish(),
      note: z.string().max(300).nullish(),
    }),
  ),
});

aiRoutes.post("/parse-ingredients", limit, async (c) => {
  const p = z.object({ lines: z.array(z.string().max(500)).max(100) }).safeParse(await c.req.json().catch(() => null));
  if (!p.success) throw new ApiError(400, "invalid_body", "lines: expected an array of at most 100 strings");
  const parsed: ParsedIngredient[] = p.data.lines.map(parseIngredient);
  const todo = parsed.map((x, i) => ({ x, i })).filter(({ x }) => !x.food && x.raw.trim());
  if (!todo.length) return c.json({ parsed });
  const config = requireAiConfig(c.get("env"));
  const out = await completeJson(config, c.get("aiFetch"), llmIngredients, {
    system: `You split ingredient lines into parts and reply with only JSON: {"items":[{"index":number,"quantity":number|null,"unit":string|null,"food":string,"note":string|null}]}. Use the given index. Keep the food name as written; do not translate.`,
    user: todo.map(({ i }, n) => `${n}: ${p.data.lines[i]}`).join("\n"),
  });
  for (const item of out.items) {
    const target = todo[item.index];
    if (!target || !item.food) continue;
    const unit = item.unit && unitByKey(item.unit) ? item.unit : null;
    Object.assign(parsed[target.i]!, { quantity: item.quantity ?? null, unit, food: item.food, note: item.note || null });
  }
  return c.json({ parsed });
});
