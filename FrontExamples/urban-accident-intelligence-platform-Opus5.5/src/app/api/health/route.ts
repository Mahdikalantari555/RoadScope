import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensureSeeded } from "@/lib/server/seed";
import { log } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    // Kick off idempotent bootstrap/seed in the background without blocking the health probe.
    ensureSeeded().catch((e) => log("error", "Seeding failed", { error: String(e) }));
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
