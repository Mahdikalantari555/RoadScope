import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const started = Date.now();
    const result = await db.execute(sql`select 1 as ok`);
    const latencyMs = Date.now() - started;
    return NextResponse.json({
      status: "ok",
      service: "urban-accident-intelligence",
      version: "1.0.0",
      database: {
        connected: true,
        latencyMs,
        postgis: false,
        spatialEngine: "lib/geo.ts (local-equirectangular metric frame)",
        row: (result as unknown as { rows: { ok: number }[] }).rows?.[0]?.ok ?? 1,
      },
      data: {
        synthetic: true,
        notice: "All datasets served by this build are synthetic.",
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "degraded",
        database: { connected: false, error: String(err) },
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
