import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accidents, reportVerifications } from "@/db/schema";
import { getMeta } from "@/lib/server/data";
import { ApiError, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/track/:code — public, privacy-preserving status lookup by tracking code. */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ code: string }> }) => {
  const code = decodeURIComponent((await ctx.params).code).trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,24}$/.test(code)) throw new ApiError(400, "Invalid tracking code format");
  const meta = await getMeta();
  const [a] = await db
    .select({ id: accidents.id, trackingCode: accidents.trackingCode, status: accidents.status, occurredAt: accidents.occurredAt, reportedAt: accidents.reportedAt, updatedAt: accidents.updatedAt, categoryId: accidents.categoryId, severityId: accidents.severityId, lon: accidents.lon, lat: accidents.lat, flags: accidents.qualityFlags })
    .from(accidents)
    .where(eq(accidents.trackingCode, code));
  if (!a) throw new ApiError(404, "No report found for this tracking code");
  const history = await db.select({ action: reportVerifications.action, newStatus: reportVerifications.newStatus, createdAt: reportVerifications.createdAt }).from(reportVerifications).where(eq(reportVerifications.accidentId, a.id)).orderBy(desc(reportVerifications.createdAt));
  const { id, categoryId, severityId, ...rest } = a;
  void id;
  return Response.json({ ...rest, category: meta.catById.get(categoryId), severity: meta.sevById.get(severityId)?.code, history });
});
