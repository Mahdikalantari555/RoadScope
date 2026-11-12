/** Password hashing and demo credentials (no framework dependencies). */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { DEMO_ACCOUNTS } from "./demoAccounts";

export { DEMO_ACCOUNTS };

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, digest] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const derived = scryptSync(password, salt, 32);
  const expected = Buffer.from(digest, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
