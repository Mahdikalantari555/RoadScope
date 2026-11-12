import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accidents, datasetSources, reportAttachments, reportVerifications, users } from "@/db/schema";
import { currentUser, requireAdmin } from "@/lib/server/auth";
import { audit, getMeta, getNetwork, snapToNetwork } from "@/lib/server/data";
import { ApiError, handle, parseBody } from "@/lib/server/http";
import { editSchema } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function load(id: number, admin: boolean) {
  const meta = await getMeta();
  const [a] = await db.select().from(accidents).where(eq(accidents.id, id));
  if (!a) throw new ApiError(404, "Accident not found");
  const [ds] = await db.select({ code: datasetSources.code, name: datasetSources.name, kind: datasetSources.kind }).from(datasetSources).where(eq(datasetSources.id, a.datasetId));
  const net = await getNetwork();
  const seg = a.segmentId ? net?.byId.get(a.segmentId) : undefined;
  const atts = await db.select({ id: reportAttachments.id, fileName: reportAttachments.fileName, mimeType: reportAttachments.mimeType, sizeBytes: reportAttachments.sizeBytes }).from(reportAttachments).where(eq(reportAttachments.accidentId, id));
  const history = admin
    ? await db
        .select({ id: reportVerifications.id, action: reportVerifications.action, previousStatus: reportVerifications.previousStatus, newStatus: reportVerifications.newStatus, note: reportVerifications.note, createdAt: reportVerifications.createdAt, reviewer: users.displayName })
        .from(reportVerifications)
        .leftJoin(users, eq(users.id, reportVerifications.reviewerId))
        .where(eq(reportVerifications.accidentId, id))
        .orderBy(desc(reportVerifications.createdAt))
    : [];
  let duplicateOf = null;
  if (a.duplicateOfId) {
    const [d] = await db.select({ id: accidents.id, trackingCode: accidents.trackingCode, occurredAt: accidents.occurredAt, lon: accidents.lon, lat: accidents.lat, status: accidents.status, categoryId: accidents.categoryId, severityId: accidents.severityId }).from(accidents).where(eq(accidents.id, a.duplicateOfId));
    if (d) duplicateOf = { ...d, category: meta.catById.get(d.categoryId), severity: meta.sevById.get(d.severityId)?.code };
  }
  const { reporterContactHash, reporterId, syntheticTruth, ...pub } = a;
  return {
    ...pub,
    category: meta.catById.get(a.categoryId),
    severity: meta.sevById.get(a.severityId)?.code,
    dataset: ds,
    segment: seg ? { id: seg.id, name: seg.name, roadClass: seg.roadClass, speedLimit: seg.speedLimit, lit: seg.lit, lanes: seg.lanes, aadt: seg.aadt } : null,
    attachments: atts,
    duplicateOf,
    history,
    ...(admin ? { hasContact: !!reporterContactHash, reporterId, syntheticTruth } : {}),
  };
}

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) throw new ApiError(400, "Invalid id");
  const user = await currentUser();
  return Response.json(await load(id, user?.role === "admin"));
});

/** PATCH /api/accidents/:id — administrator correction of a record (original coordinates are preserved). */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const admin = await requireAdmin();
  const id = Number((await ctx.params).id);
  const b = await parseBody(req, editSchema);
  const meta = await getMeta();
  const [before] = await db.select().from(accidents).where(eq(accidents.id, id));
  if (!before) throw new ApiError(404, "Accident not found");
  const patch: Partial<typeof accidents.$inferInsert> = { updatedAt: new Date() };
  if (b.occurredAt) {
    if (Number.isNaN(Date.parse(b.occurredAt))) throw new ApiError(422, "Invalid occurredAt");
    patch.occurredAt = new Date(b.occurredAt);
  }
  if (b.category) patch.categoryId = meta.catId.get(b.category);
  if (b.severity) patch.severityId = meta.sevId.get(b.severity);
  if (b.vehicles !== undefined) patch.vehicles = b.vehicles;
  if (b.description !== undefined) patch.description = b.description;
  if (b.emergencyServices !== undefined) patch.emergencyServices = b.emergencyServices;
  if (b.lon !== undefined && b.lat !== undefined) {
    const s = await snapToNetwork(b.lon, b.lat);
    Object.assign(patch, { lon: s.lon, lat: s.lat, x: s.x, y: s.y, segmentId: s.segmentId, snapDistanceM: s.snapDistanceM });
  }
  await db.update(accidents).set(patch).where(eq(accidents.id, id));
  await db.insert(reportVerifications).values({ accidentId: id, reviewerId: admin.id, action: "edit", previousStatus: before.status, newStatus: before.status, note: b.note || `Edited fields: ${Object.keys(b).filter((k) => k !== "note").join(", ")}` });
  await audit(admin.id, "accident.edit", "accident", id, { fields: Object.keys(b) });
  return Response.json(await load(id, true));
});
