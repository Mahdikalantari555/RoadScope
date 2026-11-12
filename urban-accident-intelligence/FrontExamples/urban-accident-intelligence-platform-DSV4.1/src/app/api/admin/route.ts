import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accidents, datasetSources, reportVerifications } from "@/db/schema";
import { jsonError, jsonOk, logAudit, requireSession } from "@/lib/api";
import { computeStatistics } from "@/lib/analytics";
import { loadAccidents, loadAuditLogs, loadMetadata, loadModerationQueue, parseStatusParam } from "@/lib/adminData";
import { parseFilters } from "@/lib/filters";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireSession(["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "queue";
    const statuses = parseStatusParam(url.searchParams.get("status"));
    const [queue, meta, audit, filters] = await Promise.all([
      loadModerationQueue(statuses, 80),
      loadMetadata(),
      loadAuditLogs(60),
      Promise.resolve(parseFilters({ status: "reported,verified,rejected" })),
    ]);
    void filters;
    const allAccidents = await loadAccidents(parseFilters({ status: "reported,verified,rejected" }), 8000);
    const categoryLabels = Object.fromEntries(meta.categories.map((c) => [c.code, { label: c.label, color: c.color }]));
    const severityLabels = Object.fromEntries(meta.severities.map((s) => [s.code, { label: s.label, color: s.color }]));
    const stats = computeStatistics(allAccidents, meta.segments, categoryLabels, severityLabels);
    const pending = await db.execute<{ count: number }>(sql`select count(*)::int as count from accidents where status = 'reported'`);
    const duplicates = await db.execute<{ count: number }>(sql`select count(*)::int as count from accidents where status = 'duplicate'`);

    return jsonOk({
      view,
      statuses,
      queue,
      audit,
      datasets: meta.datasets,
      quality: {
        totalRecords: stats.total,
        pending: pending.rows[0]?.count ?? 0,
        duplicates: duplicates.rows[0]?.count ?? 0,
        rejected: allAccidents.filter((a) => a.status === "rejected").length,
        verifiedShare: stats.completeness.verified,
        weatherCompleteness: stats.completeness.weather,
        lightingCompleteness: stats.completeness.lighting,
        segmentCompleteness: stats.completeness.segment,
        descriptionCompleteness: stats.completeness.description,
        medianDelayHours: stats.delay.medianH,
        p90DelayHours: stats.delay.p90H,
        medianUncertaintyM: stats.uncertainty.medianM,
        uncertaintyOver30m: stats.uncertainty.shareOver30m,
        qualityFlags: countFlags(allAccidents),
      },
      role: auth.session.role,
    });
  } catch (error) {
    console.error("GET /api/admin failed", error);
    return jsonError("Unable to load the administration view.", 500);
  }
}

function countFlags(records: { qualityFlags: string[] }[]): { flag: string; count: number }[] {
  const map = new Map<string, number>();
  records.forEach((record) => {
    (record.qualityFlags ?? []).forEach((flag) => map.set(flag, (map.get(flag) ?? 0) + 1));
  });
  return Array.from(map.entries())
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count);
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["verify", "reject", "mark_duplicate", "reopen"]),
    publicId: z.string(),
    notes: z.string().max(600).optional(),
    duplicateOfPublicId: z.string().optional(),
  }),
  z.object({
    action: z.literal("edit"),
    publicId: z.string(),
    severityCode: z.number().int().min(1).max(4).optional(),
    categoryCode: z.string().optional(),
    description: z.string().max(1500).optional(),
    notes: z.string().max(600).optional(),
  }),
  z.object({
    action: z.enum(["activate_dataset", "deactivate_dataset"]),
    datasetId: z.number().int(),
    notes: z.string().max(600).optional(),
  }),
]);

export async function POST(request: Request) {
  const auth = await requireSession(["admin"]);
  if ("response" in auth) return auth.response;
  try {
    const parsed = actionSchema.safeParse(await request.json());
    if (!parsed.success) return jsonError("Invalid moderation action.", 422, parsed.error.flatten());
    const payload = parsed.data;

    if (payload.action === "activate_dataset" || payload.action === "deactivate_dataset") {
      await db
        .update(datasetSources)
        .set({ isActive: payload.action === "activate_dataset" })
        .where(eq(datasetSources.id, payload.datasetId));
      await logAudit({
        actor: auth.session.email,
        action: payload.action,
        entityType: "dataset_source",
        entityId: String(payload.datasetId),
      });
      return jsonOk({ ok: true, message: "Dataset visibility updated." });
    }

    if (!("publicId" in payload)) return jsonError("A record reference is required.", 422);
    const target = await db.select().from(accidents).where(eq(accidents.publicId, payload.publicId)).limit(1);
    if (target.length === 0) return jsonError("Accident not found.", 404);
    const record = target[0];
    const update: Record<string, unknown> = { updatedAt: new Date() };
    const action = payload.action;
    if (payload.action === "verify") {
      update.status = "verified";
      update.verifiedAt = new Date();
      update.verifiedBy = auth.session.userId;
    } else if (payload.action === "reject") {
      update.status = "rejected";
    } else if (payload.action === "reopen") {
      update.status = "reported";
    } else if (payload.action === "mark_duplicate") {
      if (!payload.duplicateOfPublicId) return jsonError("duplicateOfPublicId is required.", 422);
      const original = await db.select({ id: accidents.id }).from(accidents).where(eq(accidents.publicId, payload.duplicateOfPublicId)).limit(1);
      if (original.length === 0) return jsonError("Original accident not found.", 404);
      update.status = "duplicate";
      update.duplicateOfId = original[0].id;
      update.duplicateScore = 1;
    } else if (payload.action === "edit") {
      if (payload.severityCode) update.severityCode = payload.severityCode;
      if (payload.categoryCode) update.categoryCode = payload.categoryCode;
      if (payload.description !== undefined) update.description = payload.description;
    }

    await db.update(accidents).set(update).where(eq(accidents.id, record.id));
    await db.insert(reportVerifications).values({
      accidentId: record.id,
      verifierId: auth.session.userId,
      action,
      previousStatus: record.status,
      newStatus: (update.status as string) ?? record.status,
      notes: payload.notes ?? null,
    });
    await logAudit({
      actor: `${auth.session.name} (${auth.session.email})`,
      action: `moderation.${action}`,
      entityType: "accident",
      entityId: payload.publicId,
      detail: { previousStatus: record.status, newStatus: update.status ?? record.status },
    });

    return jsonOk({ ok: true, publicId: payload.publicId, status: update.status ?? record.status });
  } catch (error) {
    console.error("POST /api/admin failed", error);
    return jsonError("Moderation action failed.", 500);
  }
}
