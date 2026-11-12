/**
 * Role-based access control for the demonstration deployment.
 *
 * Sessions are stateless, HMAC-signed cookies. Passwords use scrypt with a
 * per-user salt. In a production deployment this would be delegated to an OIDC
 * provider; the role model (citizen / analyst / admin) stays the same.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { DEMO_ACCOUNTS, hashPassword, verifyPassword } from "./password";
import { ROLE_DESCRIPTIONS, type Role } from "./roles";

export { DEMO_ACCOUNTS, hashPassword, verifyPassword, ROLE_DESCRIPTIONS };
export type { Role };

export type Session = {
  userId: number;
  email: string;
  name: string;
  role: Role;
  exp: number;
};

export const SESSION_COOKIE = "uai_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function secret(): string {
  return process.env.SESSION_SECRET ?? "uai-development-session-secret-do-not-use-in-production";
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString()) as Session;
    if (!parsed.exp || parsed.exp < Date.now() / 1000) return null;
    if (!["citizen", "analyst", "admin"].includes(parsed.role)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function newSession(user: { id: number; email: string; displayName: string; role: string }): Session {
  return {
    userId: user.id,
    email: user.email,
    name: user.displayName,
    role: user.role as Role,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  return decodeSession(store.get(SESSION_COOKIE)?.value);
}

export function canModerate(role: Role | undefined | null): boolean {
  return role === "admin";
}

export function canAnalyse(role: Role | undefined | null): boolean {
  return role === "admin" || role === "analyst";
}
