import { randomUUID } from "node:crypto";
import { count, eq, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import {
  loginSchema,
  registerSchema,
  setupSchema,
  signupModes,
  z,
  type AuthStatus,
  type MeResponse,
  type SignupMode,
} from "@meally/shared";
import type { Db } from "../../db/index.js";
import { instanceSettings, users } from "../../db/schema/index.js";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { findValidInvite } from "../friends/service.js";
import { clearSessionCookie, requireAuth, setSessionCookie, toSessionUser } from "./middleware.js";
import { createSession, deleteSession, SESSION_COOKIE } from "./sessions.js";

export const SIGNUP_KEY = "signup_mode";
export const DEFAULT_SIGNUP_MODE: SignupMode = "invite";

export async function resolveSignupMode(db: Db, locked: SignupMode | null): Promise<SignupMode> {
  if (locked) return locked;
  const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, SIGNUP_KEY)).limit(1);
  const parsed = z.enum(signupModes).safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_SIGNUP_MODE;
}

const needsSetup = async (db: Pick<Db, "select">) => ((await db.select({ n: count() }).from(users))[0]?.n ?? 0) === 0;

async function body<S extends z.ZodTypeAny>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "invalid_body", parsed.error.issues[0]?.message ?? "Invalid request");
  return parsed.data;
}

export function clientIp(c: Context<AppEnv>): string {
  if (c.get("auth").trustProxy) {
    const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (fwd) return fwd;
  }
  // Node (@hono/node-server) binds `incoming`; Deno.serve passes `remoteAddr`. Read both without importing either.
  const e = c.env as { incoming?: { socket?: { remoteAddress?: string } }; remoteAddr?: { hostname?: string } } | undefined;
  return e?.incoming?.socket?.remoteAddress ?? e?.remoteAddr?.hostname ?? "unknown";
}

function limit(c: Context<AppEnv>, kind: "login" | "register") {
  const a = c.get("auth");
  const r = (kind === "login" ? a.loginLimiter : a.registerLimiter).hit(clientIp(c));
  if (!r.ok) {
    c.header("Retry-After", String(r.retryAfterSec));
    throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
  }
}

async function createAccount(
  c: Context<AppEnv>,
  input: { email: string; name: string; password: string },
  opts: { role: "admin" | "member"; requireEmpty?: boolean },
) {
  const db = c.get("db");
  const passwordHash = await c.get("platform").hasher.hash(input.password);
  const now = new Date();
  const userId = randomUUID();
  await db.transaction(async (tx) => {
    // Serialise sign-ups so the "first user" and unique-email checks cannot interleave across connections.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(727001)`);
    if (opts.requireEmpty && !(await needsSetup(tx))) {
      throw new ApiError(409, "setup_done", "Setup has already been completed");
    }
    if ((await tx.select().from(users).where(eq(users.email, input.email)).limit(1)).length > 0) {
      throw new ApiError(409, "email_taken", "An account with this email already exists");
    }
    await tx.insert(users).values({
      id: userId,
      email: input.email,
      name: input.name,
      passwordHash,
      role: opts.role,
      createdAt: now,
    });
  });
  setSessionCookie(c, await createSession(db, userId, c.req.header("user-agent")));
  const res: MeResponse = { user: { id: userId, email: input.email, name: input.name, role: opts.role } };
  return c.json(res, 201);
}

// Computed lazily so unknown emails cost the same as wrong passwords.
let dummyHash: Promise<string> | undefined;

export const authRoutes = new Hono<AppEnv>()
  .get("/status", async (c) => {
    const db = c.get("db");
    const status: AuthStatus = {
      needsSetup: await needsSetup(db),
      signupMode: await resolveSignupMode(db, c.get("auth").lockedSignupMode),
    };
    return c.json(status);
  })
  .post("/setup", async (c) => {
    limit(c, "register");
    const input = await body(c, setupSchema);
    if (!(await needsSetup(c.get("db")))) throw new ApiError(409, "setup_done", "Setup has already been completed");
    return createAccount(c, input, { role: "admin", requireEmpty: true });
  })
  .post("/register", async (c) => {
    limit(c, "register");
    const db = c.get("db");
    if (await needsSetup(db)) throw new ApiError(409, "setup_required", "Complete first-run setup first");
    const mode = await resolveSignupMode(db, c.get("auth").lockedSignupMode);
    if (mode === "closed") throw new ApiError(403, "signup_closed", "Sign-ups are closed");
    const input = await body(c, registerSchema);
    // In invite mode a valid, unused Friendship invite is the permit. It is only checked here, not used up:
    // the new user accepts it afterwards. With the friends flag off the token is ignored.
    const permit =
      !!input.inviteToken &&
      (await c.get("flags").getFeatures()).friends.enabled &&
      !!(await findValidInvite(db, input.inviteToken));
    if (mode === "invite" && !permit) throw new ApiError(403, "invite_required", "An invitation is required to sign up");
    return createAccount(c, input, { role: "member" });
  })
  .post("/login", async (c) => {
    limit(c, "login");
    const input = await body(c, loginSchema);
    const db = c.get("db");
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    dummyHash ??= c.get("platform").hasher.hash("meally-dummy");
    const hasher = c.get("platform").hasher;
    const { ok, needsRehash } = await hasher.verify(input.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok) throw new ApiError(401, "invalid_credentials", "Incorrect email or password");
    // Rehash on login: move the stored hash to this platform's preferred scheme and cost.
    if (needsRehash) await db.update(users).set({ passwordHash: await hasher.hash(input.password) }).where(eq(users.id, user.id));
    setSessionCookie(c, await createSession(db, user.id, c.req.header("user-agent")));
    const res: MeResponse = { user: toSessionUser(user) };
    return c.json(res);
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.get("db"), token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, async (c) => {
    const res: MeResponse = { user: c.get("user") };
    return c.json(res);
  });
