import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureBootstrap } from "@/lib/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await ensureBootstrap();
    const result = await db.execute<{ accidents: number; verified: number; segments: number }>(sql`
      select
        (select count(*)::int from accidents) as accidents,
        (select count(*)::int from accidents where status = 'verified') as verified,
        (select count(*)::int from road_segments) as segments
    `);
    return Response.json({
      ok: true,
      database: "postgresql",
      spatialEngine: "local equidistant projection (metric-correct)",
      datasets: result.rows[0] ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("health check failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
