/**
 * Application bootstrap, executed once per process before the first API request:
 *  1. applies Drizzle migrations (drizzle/ folder, including spatial indexes),
 *  2. ensures administrator and demonstration accounts exist (from environment configuration),
 *  3. seeds the synthetic demonstration workspace when the database is empty.
 */
import path from "node:path";
import { count } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/db";
import { roadSegments, users } from "@/db/schema";
import { hashPassword } from "./auth";
import { config } from "./config";
import { bootstrapDemoWorkspace, ensureReferenceData } from "./datasets";
import { logger } from "./logger";

let ready: Promise<void> | null = null;

export function ensureReady(): Promise<void> {
  if (!ready) {
    ready = initialise().catch((error: unknown) => {
      ready = null;
      throw error;
    });
  }
  return ready;
}

async function ensureAccount(email: string, password: string, displayName: string, role: "admin" | "user"): Promise<void> {
  if (!email || !password) return;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  if (existing) return;
  await db.insert(users).values({ email: email.toLowerCase(), displayName, passwordHash: await hashPassword(password), role });
  logger.info("account.created", { role });
}

import { eq } from "drizzle-orm";

async function initialise(): Promise<void> {
  const started = Date.now();
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await ensureReferenceData();
  await ensureAccount(config.adminEmail, config.adminPassword, "Administrator", "admin");
  await ensureAccount(config.demoUserEmail, config.demoUserPassword, "Demo analyst", "user");
  const [{ n }] = await db.select({ n: count() }).from(roadSegments);
  if (n === 0) {
    logger.info("bootstrap.seeding_demo_workspace");
    await bootstrapDemoWorkspace();
  }
  logger.info("bootstrap.ready", { ms: Date.now() - started });
}
