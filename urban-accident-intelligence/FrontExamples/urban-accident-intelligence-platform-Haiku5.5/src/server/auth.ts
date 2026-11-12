/**
 * Authentication and authorisation: scrypt password hashing, opaque session tokens stored as
 * SHA-256 digests, HMAC-based privacy-preserving identifiers, and role guards.
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type UserRow } from "@/db/schema";
import type { SessionUser } from "@/lib/api-types";
import { config } from "./config";
import { ApiError } from "./http";
import { logger } from "./logger";

const scryptAsync = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = "uai_session";
const SESSION_TTL_MS = 12 * 3600 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

let warnedAboutSecret = false;

/** HMAC key for session hashing and privacy-preserving identifiers. */
function secret(): string {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 16) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (≥16 characters) must be configured in production");
  if (!warnedAboutSecret) {
    logger.warn("SESSION_SECRET not configured; using an insecure development secret");
    warnedAboutSecret = true;
  }
  return "dev-insecure-secret-change-me";
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, email: row.email, displayName: row.displayName, role: row.role };
}

export function checkLoginRate(ip: string): void {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  entry.count++;
  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    throw new ApiError(429, "rate_limited", "Too many sign-in attempts. Try again in a few minutes.");
  }
}

export function clearLoginRate(ip: string): void {
  loginAttempts.delete(ip);
}

export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!row) {
    await scryptAsync(password, Buffer.alloc(16), 64); // equalise timing for unknown accounts
    return null;
  }
  const ok = await verifyPassword(password, row.passwordHash);
  return ok ? toSessionUser(row) : null;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  });
  return token;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row ? toSessionUser(row.user) : null;
}

export async function destroySession(req: Request): Promise<void> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export function sessionCookieHeader(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${config.cookieSecure ? "; Secure" : ""}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.cookieSecure ? "; Secure" : ""}`;
}

/** Keyed hash of an IP address; never stored in clear text. */
export function hashIp(ip: string): string {
  return createHmac("sha256", secret()).update(`ip|${ip}`).digest("hex").slice(0, 32);
}

/**
 * Daily-rotating pseudonymous reporter identifier used for rate limiting and abuse review.
 * The raw IP address is not persisted, and the identifier cannot be linked across days.
 */
export function reporterHashFor(ip: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return createHmac("sha256", secret()).update(`reporter|${day}|${ip}`).digest("hex").slice(0, 32);
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new ApiError(401, "unauthenticated", "Sign in is required for this action");
  return user;
}

export function requireAdmin(user: SessionUser | null): SessionUser {
  const u = requireUser(user);
  if (u.role !== "admin") throw new ApiError(403, "forbidden", "Administrator role required");
  return u;
}
