import { z } from "@meally/shared";

const schema = z.object({
  DATA_DIR: z.string().default("./data"),
  /** Set to use an external Postgres (postgres-js); unset uses embedded PGlite under DATA_DIR/pgdata. */
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8080),
  BASE_URL: z.string().default("http://localhost:8080"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  MEALLY_BACKUP_CRON_HOURS: z.coerce.number().min(0).default(24),
  MEALLY_BACKUP_KEEP: z.coerce.number().int().min(1).default(7),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return schema.parse(env);
}

export const config = loadConfig();
