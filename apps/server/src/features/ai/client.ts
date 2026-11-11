import type { z } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";

export type AiFetch = typeof fetch;
export interface AiConfig {
  provider: "anthropic" | "openai";
  apiKey: string | null;
  model: string;
  baseUrl: string;
}
export interface AiImage {
  mediaType: string;
  base64: string;
}

export const AI_TIMEOUT_MS = 60_000;
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

/** Reads MEALLY_AI_* from the environment. Returns null when nothing usable is configured. */
export function loadAiConfig(env: Record<string, string | undefined>): AiConfig | null {
  const provider = env.MEALLY_AI_PROVIDER?.trim().toLowerCase();
  const apiKey = env.MEALLY_AI_API_KEY?.trim() || null;
  const baseUrlRaw = env.MEALLY_AI_BASE_URL?.trim();
  if (provider === "anthropic") {
    if (!apiKey) return null;
    return {
      provider,
      apiKey,
      model: env.MEALLY_AI_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL,
      baseUrl: (baseUrlRaw || "https://api.anthropic.com").replace(/\/+$/, ""),
    };
  }
  if (provider === "openai") {
    const model = env.MEALLY_AI_MODEL?.trim();
    // Local servers (Ollama, LM Studio) need no key but do need an address.
    if (!model || (!apiKey && !baseUrlRaw)) return null;
    return { provider, apiKey, model, baseUrl: (baseUrlRaw || "https://api.openai.com").replace(/\/+$/, "") };
  }
  return null;
}

export function requireAiConfig(env: Record<string, string | undefined>): AiConfig {
  const config = loadAiConfig(env);
  if (!config) throw new ApiError(503, "ai_not_configured", "AI helpers are not configured on this server");
  return config;
}

/** One model call; returns the raw text. Errors never include prompt contents. */
export async function callModel(
  config: AiConfig,
  doFetch: AiFetch,
  req: { system: string; user: string; images?: AiImage[] },
): Promise<string> {
  const images = req.images ?? [];
  let url: string;
  let headers: Record<string, string>;
  let body: unknown;
  if (config.provider === "anthropic") {
    url = `${config.baseUrl}/v1/messages`;
    headers = { "content-type": "application/json", "x-api-key": config.apiKey!, "anthropic-version": "2023-06-01" };
    body = {
      model: config.model,
      max_tokens: 4096,
      system: req.system,
      messages: [
        {
          role: "user",
          content: [
            ...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: i.base64 } })),
            { type: "text", text: req.user },
          ],
        },
      ],
    };
  } else {
    url = `${config.baseUrl}${/\/v1$/.test(config.baseUrl) ? "" : "/v1"}/chat/completions`;
    headers = { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) };
    body = {
      model: config.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            { type: "text", text: req.user },
            ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mediaType};base64,${i.base64}` } })),
          ],
        },
      ],
    };
  }
  let res: Response;
  try {
    res = await doFetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new ApiError(504, "ai_timeout", "The AI provider took too long to answer");
    throw new ApiError(502, "ai_failed", "Could not reach the AI provider");
  }
  if (!res.ok) throw new ApiError(502, "ai_failed", `The AI provider returned an error (${res.status})`);
  const json = (await res.json().catch(() => null)) as any;
  const text =
    config.provider === "anthropic"
      ? (json?.content as Array<{ type: string; text?: string }> | undefined)?.find((b) => b.type === "text")?.text
      : json?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new ApiError(502, "ai_invalid_response", "The AI provider sent an unexpected answer");
  return text;
}

function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

/** Asks for JSON, validates it with zod, and retries once with the problem described. */
export async function completeJson<S extends z.ZodTypeAny>(
  config: AiConfig,
  doFetch: AiFetch,
  schema: S,
  req: { system: string; user: string; images?: AiImage[] },
): Promise<z.output<S>> {
  let user = req.user;
  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await callModel(config, doFetch, { ...req, user });
    let problem: string;
    try {
      const parsed = schema.safeParse(extractJson(text));
      if (parsed.success) return parsed.data;
      problem = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch {
      problem = "the reply was not valid JSON";
    }
    user = `${req.user}\n\nYour previous reply was rejected (${problem}). Reply again with only the corrected JSON object.`;
  }
  throw new ApiError(502, "ai_invalid_response", "The AI provider did not return a usable recipe");
}
