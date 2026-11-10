import { z } from "@meally/shared";

const schema = z.object({
  DATA_DIR: z.string().default("./data"),
  PORT: z.coerce.number().int().positive().default(8080),
  BASE_URL: z.string().default("http://localhost:8080"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

export const config = loadConfig();
