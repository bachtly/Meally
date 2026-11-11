import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionUser } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";
import type { AppEnv } from "../../lib/context.js";
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from "./sessions.js";

export function setSessionCookie(c: Context<AppEnv>, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: c.get("auth").secureCookies,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}
export function clearSessionCookie(c: Context<AppEnv>) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: c.get("auth").secureCookies });
}

export function toSessionUser(u: SessionUser): SessionUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, householdId: u.householdId };
}

/** Requires a valid session cookie; sets `user` and `householdId`. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? resolveSession(c.get("db"), token) : null;
  if (!token || !session) {
    if (token) clearSessionCookie(c);
    throw new ApiError(401, "unauthenticated", "Sign in to continue");
  }
  if (session.refreshed) setSessionCookie(c, token);
  c.set("user", toSessionUser(session.user));
  c.set("householdId", session.user.householdId);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("user").role !== "admin") throw new ApiError(403, "forbidden", "Admin access required");
  await next();
};

/**
 * CSRF defence for cookie sessions: unsafe methods need a same-origin `Origin`,
 * or no `Origin` plus the `X-Requested-With` header (which a cross-site form cannot set).
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();
  if (!getCookie(c, SESSION_COOKIE)) return next();
  const origin = c.req.header("origin");
  if (origin) {
    const allowed = [new URL(c.req.url).origin, c.get("auth").baseOrigin];
    if (!allowed.includes(origin)) throw new ApiError(403, "csrf", "Cross-origin request blocked");
  } else if (!c.req.header("x-requested-with")) {
    throw new ApiError(403, "csrf", "Missing X-Requested-With header");
  }
  await next();
};
