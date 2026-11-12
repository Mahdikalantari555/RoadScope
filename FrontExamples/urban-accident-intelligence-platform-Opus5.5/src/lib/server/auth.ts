import { cookies } from "next/headers";
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ApiError, log } from "./http";

export const SESSION_COOKIE = "uai_session";
const SESSION_TTL_S = 60 * 60 * 12;

let warned = false;
function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!warned) {
    log("warn", "SESSION_SECRET not set — using a per-database derived development secret. Set SESSION_SECRET in production.");
    warned = true;
  }
  return createHash("sha256").update(`uai-dev:${process.env.DATABASE_URL ?? ""}`).digest("hex");
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pw, salt, 32);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Salted one-way hash for optional reporter contact details (privacy by design). */
export function hashContact(contact: string): string {
  return createHmac("sha256", secret()).update(contact.trim().toLowerCase()).digest("hex");
}

export function signSession(userId: number): string {
  const payload = `${userId}.${Math.floor(Date.now() / 1000) + SESSION_TTL_S}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function readSession(token: string | undefined): number | null {
  if (!token) return null;
  const [uid, exp, sig] = token.split(".");
  if (!uid || !exp || !sig) return null;
  const expected = createHmac("sha256", secret()).update(`${uid}.${exp}`).digest("base64url");
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return Number(uid);
}

export interface SessionUser {
  id: number;
  email: string;
  displayName: string;
  role: "citizen" | "admin";
}

export async function currentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const id = readSession(store.get(SESSION_COOKIE)?.value);
  if (!id) return null;
  const [u] = await db.select({ id: users.id, email: users.email, displayName: users.displayName, role: users.role }).from(users).where(eq(users.id, id));
  return u ?? null;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new ApiError(401, "Authentication required");
  if (u.role !== "admin") throw new ApiError(403, "Administrator role required");
  return u;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_TTL_S,
  secure: process.env.COOKIE_SECURE === "true",
};
