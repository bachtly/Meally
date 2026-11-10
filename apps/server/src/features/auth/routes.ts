import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  loginSchema,
  registerSchema,
  setupSchema,
  signupModes,
  z,
  type AuthStatus,
  type InviteLookup,
  type MeResponse,
  type SignupMode,
} from "@meally/shared";
import type { Db } from "../../db/index.js";
import { households, instanceSettings, users } from "../../db/schema/index.js";
import type { AppEnv } from "../../lib/context.js";
import { ApiError } from "../../lib/errors.js";
import { clearSessionCookie, requireAuth, setSessionCookie, toSessionUser } from "./middleware.js";
import { consumeInvite, findValidInvite } from "../households/service.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSession, deleteSession, SESSION_COOKIE } from "./sessions.js";

const SIGNUP_KEY = "signup_mode";
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
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
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
  opts: { role: "admin" | "member"; householdName: string; requireEmpty?: boolean; inviteToken?: string },
) {
  const db = c.get("db");
  const passwordHash = await hashPassword(input.password, c.get("auth").scryptLogN);
  const now = new Date();
  let householdId: string = randomUUID();
  let householdRole: "owner" | "member" = "owner";
  let householdName = opts.householdName;
  const userId = randomUUID();
  // The write transaction holds the single connection, so the empty check and insert cannot interleave.
  await db.transaction(async (tx) => {
    if (opts.requireEmpty && !(await needsSetup(tx))) {
      throw new ApiError(409, "setup_done", "Setup has already been completed");
    }
    if ((await tx.select().from(users).where(eq(users.email, input.email)).limit(1)).length > 0) {
      throw new ApiError(409, "email_taken", "An account with this email already exists");
    }
    if (opts.inviteToken) {
      const joined = await consumeInvite(tx, opts.inviteToken, input.email);
      householdId = joined.householdId;
      householdRole = joined.role;
      const [h] = await tx.select().from(households).where(eq(households.id, householdId)).limit(1);
      householdName = h!.name;
    } else {
      await tx.insert(households).values({ id: householdId, name: householdName, createdAt: now });
    }
    await tx.insert(users).values({
      id: userId,
      email: input.email,
      name: input.name,
      passwordHash,
      role: opts.role,
      householdId,
      householdRole,
      createdAt: now,
    });
  });
  setSessionCookie(c, await createSession(db, userId, c.req.header("user-agent")));
  const res: MeResponse = {
    user: { id: userId, email: input.email, name: input.name, role: opts.role, householdId, householdRole },
    household: { id: householdId, name: householdName },
  };
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
    return createAccount(c, input, {
      role: "admin",
      householdName: input.householdName ?? `${input.name}'s household`,
      requireEmpty: true,
    });
  })
  .post("/register", async (c) => {
    limit(c, "register");
    const db = c.get("db");
    if (await needsSetup(db)) throw new ApiError(409, "setup_required", "Complete first-run setup first");
    const mode = await resolveSignupMode(db, c.get("auth").lockedSignupMode);
    if (mode === "closed") throw new ApiError(403, "signup_closed", "Sign-ups are closed");
    const input = await body(c, registerSchema);
    // A valid invite token works in every mode except closed; invite mode requires one.
    // Invites belong to the households feature, so with the flag off the token is ignored.
    const useInvite = !!input.inviteToken && (await c.get("flags").getFeatures()).households.enabled;
    if (mode === "invite" && !useInvite) throw new ApiError(403, "invite_required", "An invitation is required to sign up");
    return createAccount(c, input, {
      role: "member",
      householdName: `${input.name}'s household`,
      inviteToken: useInvite ? input.inviteToken : undefined,
    });
  })
  .get("/invite/:token", async (c) => {
    const r = c.get("auth").inviteLimiter.hit(clientIp(c));
    if (!r.ok) {
      c.header("Retry-After", String(r.retryAfterSec));
      throw new ApiError(429, "rate_limited", "Too many attempts. Try again later.");
    }
    const on = (await c.get("flags").getFeatures()).households.enabled;
    const found = on ? await findValidInvite(c.get("db"), c.req.param("token")) : null;
    const res: InviteLookup = { householdName: found?.householdName ?? "", valid: !!found };
    return c.json(res);
  })
  .post("/login", async (c) => {
    limit(c, "login");
    const input = await body(c, loginSchema);
    const db = c.get("db");
    const [user] = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
    dummyHash ??= hashPassword("meally-dummy", c.get("auth").scryptLogN);
    const ok = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash));
    if (!user || !ok) throw new ApiError(401, "invalid_credentials", "Incorrect email or password");
    setSessionCookie(c, await createSession(db, user.id, c.req.header("user-agent")));
    const [household] = await db.select().from(households).where(eq(households.id, user.householdId)).limit(1);
    const res: MeResponse = { user: toSessionUser(user), household: { id: household!.id, name: household!.name } };
    return c.json(res);
  })
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.get("db"), token);
    clearSessionCookie(c);
    return c.json({ ok: true });
  })
  .get("/me", requireAuth, async (c) => {
    const [household] = await c.get("db").select().from(households).where(eq(households.id, c.get("householdId"))).limit(1);
    const res: MeResponse = { user: c.get("user"), household: { id: household!.id, name: household!.name } };
    return c.json(res);
  });
