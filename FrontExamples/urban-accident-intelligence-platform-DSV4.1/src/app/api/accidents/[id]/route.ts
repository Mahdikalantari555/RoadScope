import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accidents, reportVerifications } from "@/db/schema";
import { jsonError, jsonOk, logAudit, requireSession } from "@/lib/api";
import { loadAccidentDetail } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const detail = await loadAccidentDetail(id);
  if (!detail) return jsonError("Accident not found.", 404);
  const related = await db.execute<{ public_id: string; status: string; distance_m: number }>(sql`
    select a.public_id, a.status,
      6371000 * 2 * asin(sqrt(power(sin(radians(a.lat - ${detail.lat}) / 2), 2) +
      cos(radians(${detail.lat})) * cos(radians(a.lat)) * power(sin(radians(a.lng - ${detail.lng}) / 2), 2))) as distance_m
    from accidents a
    where a.id <> ${detail.id}
      and abs(a.lat - ${detail.lat}) < 0.004 and abs(a.lng - ${detail.lng}) < 0.006
    order by distance_m asc limit 4
  `);
  return jsonOk({
    accident: detail,
    neighbours: related.rows.map((r) => ({ publicId: r.public_id, status: r.status, distanceM: Math.round(r.distance_m) })),
  });
}

const patchSchema = z.object({
  status: z.enum(["reported", "verified", "rejected", "duplicate"]).optional(),
  severityCode: z.number().int().min(1).max(4).optional(),
  categoryCode: z.string().min(2).max(40).optional(),
  description: z.string().max(1500).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  duplicateOfPublicId: z.string().max(40).optional(),
  notes: z.string().max(600).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["admin"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid moderation payload.", 422, parsed.error.flatten());
  const detail = await loadAccidentDetail(id);
  if (!detail) return jsonError("Accident not found.", 404);

  const changes = parsed.data;
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (changes.status) update.status = changes.status;
  if (changes.severityCode) update.severityCode = changes.severityCode;
  if (changes.categoryCode) update.categoryCode = changes.categoryCode;
  if (changes.description !== undefined) update.description = changes.description;
  if (changes.lat !== undefined && changes.lng !== undefined) {
    update.lat = changes.lat;
    update.lng = changes.lng;
    update.geom = { type: "Point", coordinates: [changes.lng, changes.lat] };
  }
  if (changes.status === "verified") {
    update.verifiedAt = new Date();
    update.verifiedBy = auth.session.userId;
  }
  if (changes.duplicateOfPublicId) {
    const target = await db
      .select({ id: accidents.id })
      .from(accidents)
      .where(eq(accidents.publicId, changes.duplicateOfPublicId))
      .limit(1);
    if (target.length > 0) {
      update.duplicateOfId = target[0].id;
      update.duplicateScore = 1;
      update.status = "duplicate";
    }
  }

  await db.update(accidents).set(update).where(eq(accidents.id, detail.id));
  await db.insert(reportVerifications).values({
    accidentId: detail.id,
    verifierId: auth.session.userId,
    action: changes.status ?? (changes.duplicateOfPublicId ? "mark_duplicate" : "edit"),
    previousStatus: detail.status,
    newStatus: (update.status as string) ?? detail.status,
    notes: changes.notes ?? null,
  });
  await logAudit({
    actor: `${auth.session.name} (${auth.session.email})`,
    action: `moderation.${changes.status ?? "edit"}`,
    entityType: "accident",
    entityId: detail.publicId,
    detail: { previousStatus: detail.status, changes },
  });
  return jsonOk({ ok: true, publicId: detail.publicId, status: (update.status as string) ?? detail.status });
}
