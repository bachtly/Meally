import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { SessionUser } from "@meally/shared";
import { ApiError } from "../../lib/errors.js";
import type { AppEnv } from "../../lib/context.js";
import { resolveSession, SESSION_COOKIE, SESSION_TTL_MS } from "./sessions.js";
import { resolveToken, TOKEN_PREFIX } from "../tokens/service.js";

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
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/**
 * Requires a valid session cookie or `Authorization: Bearer mly_...`; sets `user`, `userId` and `authVia`.
 * A request that carries both is rejected: the CSRF check keys on the cookie, so letting a bearer
 * override it would make the credential in use ambiguous. Bearer-only requests have no cookie and so no CSRF risk.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookie = getCookie(c, SESSION_COOKIE);
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
  if (bearer?.startsWith(TOKEN_PREFIX)) {
    if (cookie) throw new ApiError(400, "mixed_auth", "Send either a session cookie or an API token, not both");
    const enabled = (await c.get("flags").getFeatures())["api-tokens"].enabled;
    const found = enabled ? await resolveToken(c.get("db"), bearer) : null;
    if (!found) throw new ApiError(401, "invalid_token", "The API token is invalid, revoked or expired");
    const hit = c.get("tokenLimiter").hit(found.id);
    if (!hit.ok) {
      c.header("Retry-After", String(hit.retryAfterSec));
      throw new ApiError(429, "rate_limited", "Too many requests for this token. Try again later.");
    }
    const m = c.req.method;
    if (found.scope === "read" && m !== "GET" && m !== "HEAD") {
      throw new ApiError(403, "insufficient_scope", "This token is read-only");
    }
    c.set("user", toSessionUser(found.user));
    c.set("userId", found.user.id);
    c.set("authVia", "token");
    return next();
  }
  const token = cookie;
  const session = token ? await resolveSession(c.get("db"), token) : null;
  if (!token || !session) {
    if (token) clearSessionCookie(c);
    throw new ApiError(401, "unauthenticated", "Sign in to continue");
  }
  if (session.refreshed) setSessionCookie(c, token);
  c.set("user", toSessionUser(session.user));
  c.set("userId", session.user.id);
  c.set("authVia", "session");
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
