import { randomBytes } from "node:crypto";
import { and, count, eq, ne, or, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { FEATURES, featureEnvVar, isFeatureKey, signupModes, userRoles, z } from "@meally/shared";
import { version } from "../../app-core.js";
import { countAppliedMigrations } from "../../db/core.js";
import { instanceSettings, recipes, sessions, users } from "../../db/schema/index.js";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { backupSettings } from "../backups/settings.js";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { resolveSignupMode, SIGNUP_KEY } from "../auth/routes.js";
import { SESSION_TTL_MS } from "../auth/sessions.js";

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use("*", requireAuth, requireAdmin);

async function body<S extends z.ZodTypeAny>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new ApiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

// ---- features ----

async function featureList(c: Context<AppEnv>) {
  const resolved = await c.get("flags").getFeatures();
  return FEATURES.map((f) => ({
    key: f.key,
    label: f.label,
    description: f.description,
    default: f.default,
    dependsOn: f.dependsOn.map((d) => ({ key: d, label: FEATURES.find((x) => x.key === d)?.label ?? d })),
    envVar: featureEnvVar(f.key),
    ...resolved[f.key],
  }));
}

adminRoutes.get("/features", async (c) => c.json({ features: await featureList(c) }));

adminRoutes.put("/features/:key", async (c) => {
  const key = c.req.param("key");
  if (!isFeatureKey(key)) throw new ApiError(404, "not_found", "Unknown feature");
  const { enabled } = await body(c, z.object({ enabled: z.boolean().nullable() }));
  const flags = c.get("flags");
  if ((await flags.getFeatures())[key].locked)
    throw new ApiError(409, "locked_by_env", `Locked by ${featureEnvVar(key)}; change the environment variable instead`);
  await flags.setOverride(key, enabled);
  return c.json({ features: await featureList(c) });
});

// ---- sign-up setting ----

async function signupState(c: Context<AppEnv>) {
  const locked = c.get("auth").lockedSignupMode;
  return { signupMode: await resolveSignupMode(c.get("db"), locked), locked: locked !== null, envVar: "MEALLY_SIGNUP_MODE" };
}

adminRoutes.get("/settings", async (c) => c.json(await signupState(c)));

adminRoutes.put("/settings", async (c) => {
  const { signupMode } = await body(c, z.object({ signupMode: z.enum(signupModes) }));
  if (c.get("auth").lockedSignupMode)
    throw new ApiError(409, "locked_by_env", "Locked by MEALLY_SIGNUP_MODE; change the environment variable instead");
  await c
    .get("db")
    .insert(instanceSettings)
    .values({ key: SIGNUP_KEY, value: signupMode })
    .onConflictDoUpdate({ target: instanceSettings.key, set: { value: signupMode } });
  return c.json(await signupState(c));
});

// ---- users ----

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

adminRoutes.get("/users", async (c) => {
  const db = c.get("db");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || 25, 1), 100);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
  const pat = `%${escapeLike(q)}%`;
  const where = q
    ? or(sql`lower(${users.email}) LIKE ${pat} ESCAPE '\\'`, sql`lower(${users.name}) LIKE ${pat} ESCAPE '\\'`)
    : undefined;
  const [{ n: total } = { n: 0 }] = await db.select({ n: count() }).from(users).where(where);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      // Column refs render unqualified in a single-table select, so spell out the outer users.id.
      lastExpiry: sql<Date | null>`(SELECT max(s.expires_at) FROM sessions s WHERE s.user_id = "users"."id")`.mapWith(sessions.expiresAt),
    })
    .from(users)
    .where(where)
    .orderBy(users.createdAt, users.id)
    .limit(limit)
    .offset(offset);
  return c.json({
    total,
    items: rows.map(({ lastExpiry, createdAt, ...u }) => ({
      ...u,
      createdAt: createdAt.getTime(),
      // Session expiry slides forward on use, so it approximates the last visit.
      lastSeenAt: lastExpiry ? lastExpiry.getTime() - SESSION_TTL_MS : null,
    })),
  });
});

async function findUser(c: Context<AppEnv>) {
  const [u] = await c.get("db").select().from(users).where(eq(users.id, c.req.param("id")!)).limit(1);
  if (!u) throw new ApiError(404, "not_found", "User not found");
  return u;
}
async function otherAdmins(c: Context<AppEnv>, id: string) {
  const [r] = await c.get("db").select({ n: count() }).from(users).where(and(eq(users.role, "admin"), ne(users.id, id)));
  return r?.n ?? 0;
}

adminRoutes.patch("/users/:id", async (c) => {
  const { role } = await body(c, z.object({ role: z.enum(userRoles) }));
  const u = await findUser(c);
  if (u.role === "admin" && role !== "admin" && (await otherAdmins(c, u.id)) === 0)
    throw new ApiError(409, "last_admin", "This is the only admin. Make someone else an admin first");
  await c.get("db").update(users).set({ role }).where(eq(users.id, u.id));
  return c.json({ id: u.id, role });
});

adminRoutes.delete("/users/:id", async (c) => {
  const db = c.get("db");
  const u = await findUser(c);
  if (u.role === "admin" && (await otherAdmins(c, u.id)) === 0)
    throw new ApiError(409, "last_admin", "This is the only admin and cannot be deleted");
  await db.transaction(async (tx) => {
    await tx.delete(sessions).where(eq(sessions.userId, u.id));
    await tx.delete(users).where(eq(users.id, u.id));
  });
  return c.body(null, 204);
});

adminRoutes.post("/users/:id/reset-password", async (c) => {
  const u = await findUser(c);
  // 12 random bytes as base64url: 96 bits, shown once. The user should change it after signing in.
  const temporaryPassword = randomBytes(12).toString("base64url");
  const hash = await c.get("platform").hasher.hash(temporaryPassword);
  await c.get("db").transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash }).where(eq(users.id, u.id));
    await tx.delete(sessions).where(eq(sessions.userId, u.id));
  });
  c.header("cache-control", "no-store");
  return c.json({ temporaryPassword });
});

// ---- info ----

adminRoutes.get("/info", async (c) => {
  const db = c.get("db");
  const dataDir = c.get("dataDir");
  const n = async (t: typeof users | typeof recipes) => (await db.select({ n: count() }).from(t))[0]?.n ?? 0;
  const mig = (await countAppliedMigrations(db)) ?? 0;
  const platform = c.get("platform");
  const host = (await platform.info?.(dataDir)) ?? { runtime: platform.name, uptimeSeconds: 0, dbBytes: 0, imagesBytes: 0, dataDir: "" };
  return c.json({
    version,
    nodeVersion: host.runtime,
    uptimeSeconds: host.uptimeSeconds,
    dbBytes: host.dbBytes,
    imagesBytes: host.imagesBytes,
    counts: { users: await n(users), recipes: await n(recipes) },
    migrations: mig,
    dataDir: host.dataDir,
    backupSchedule: backupSettings(c.get("env")),
  });
});
