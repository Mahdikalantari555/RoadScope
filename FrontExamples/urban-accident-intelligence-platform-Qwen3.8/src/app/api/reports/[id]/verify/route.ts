import { db } from "@/db";
import { and, desc, eq } from "drizzle-orm";
import { accidents, accidentCategories, reportVerifications, severityLevels, vgiReports } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { ApiError, handleApiError, json, readJson } from "@/lib/api";
import { resolveActor, requirePermission, writeAudit } from "@/lib/auth";
import { DEFAULT_CONFLATION, computeCredibility } from "@/lib/vgi/mapmatch";
import { CATEGORIES, SEVERITIES } from "@/lib/domain/taxonomy";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ACTIONS = ["verify", "reject", "flag", "reopen", "merge", "edit"] as const;
type Action = (typeof ACTIONS)[number];

/** GET /api/reports/:id/verify — full audit trail for a report. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const trail = await db.select().from(reportVerifications).where(eq(reportVerifications.reportId, id)).orderBy(desc(reportVerifications.createdAt));
    const [report] = await db.select().from(vgiReports).where(eq(vgiReports.id, id)).limit(1);
    if (!report) throw new ApiError(404, "report_not_found");
    return json({ reportId: id, status: report.status, trail });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * POST /api/reports/:id/verify — steward lifecycle transition with RBAC,
 * immutable audit logging and credibility recomputation.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const actor = resolveActor(req);
    const body = await readJson(req);
    const action = String(body.action ?? "") as Action;
    if (!ACTIONS.includes(action)) throw new ApiError(400, "invalid_action", ACTIONS);
    requirePermission(actor, action === "merge" ? "report:merge" : action === "reject" ? "report:reject" : "report:verify");

    const [report] = await db.select().from(vgiReports).where(eq(vgiReports.id, id)).limit(1);
    if (!report) throw new ApiError(404, "report_not_found");
    const ctx = await requireDataset(report.datasetId);
    const fromStatus = report.status;
    const reason = body.reason === undefined ? null : String(body.reason).slice(0, 1000);

    let toStatus = report.status;
    const updates: Record<string, unknown> = {};

    if (action === "verify") toStatus = "verified";
    else if (action === "reject") toStatus = "rejected";
    else if (action === "flag") toStatus = "triaged";
    else if (action === "reopen") toStatus = "unverified";
    else if (action === "merge") toStatus = "merged";

    if (action === "edit" && body.edits && typeof body.edits === "object") {
      const edits = body.edits as Record<string, unknown>;
      if (edits.severityCode) {
        if (!SEVERITIES.some((s) => s.code === edits.severityCode)) throw new ApiError(400, "invalid_severity");
        const row = await db.select().from(severityLevels).where(eq(severityLevels.code, String(edits.severityCode))).limit(1);
        if (row[0]) updates.severityId = row[0].id;
      }
      if (edits.categoryCode !== undefined) {
        if (edits.categoryCode === null || edits.categoryCode === "") updates.categoryId = null;
        else {
          if (!CATEGORIES.some((c) => c.code === edits.categoryCode)) throw new ApiError(400, "invalid_category");
          const row = await db.select().from(accidentCategories).where(eq(accidentCategories.code, String(edits.categoryCode))).limit(1);
          if (row[0]) updates.categoryId = row[0].id;
        }
      }
      if (edits.narrative !== undefined) updates.narrative = String(edits.narrative).slice(0, 2000);
      if (edits.occurrenceTime !== undefined) {
        const d = new Date(String(edits.occurrenceTime));
        if (Number.isNaN(d.getTime())) throw new ApiError(400, "invalid_occurrence_time");
        updates.occurrenceTime = d;
      }
      toStatus = report.status;
    }

    const siblings = report.accidentId
      ? await db.select().from(vgiReports).where(and(eq(vgiReports.accidentId, report.accidentId), eq(vgiReports.datasetId, ctx.dataset.id)))
      : [];
    const after = siblings.map((s) => (s.id === id ? { ...s, status: toStatus, ...updates } : s));
    const sevCounts = new Map<string, number>();
    const catCounts = new Map<string, number>();
    for (const s of after) {
      const sevRow = await db.select().from(severityLevels).where(eq(severityLevels.id, s.severityId)).limit(1);
      const code = sevRow[0]?.code ?? "property_damage";
      sevCounts.set(code, (sevCounts.get(code) ?? 0) + 1);
      const catRow = s.categoryId ? await db.select().from(accidentCategories).where(eq(accidentCategories.id, s.categoryId)).limit(1) : [];
      const c = catRow[0]?.code ?? "unknown";
      catCounts.set(c, (catCounts.get(c) ?? 0) + 1);
    }
    const n = Math.max(1, after.length);
    const times = after.map((s) => (s.occurrenceTime ?? s.occurrenceTime).getTime());
    const credibility = computeCredibility({
      witnesses: n,
      severityAgreement: Math.max(...sevCounts.values()) / n,
      categoryAgreement: Math.max(...catCounts.values()) / n,
      meanNetworkDistanceM: 0,
      timeRangeMinutes: (Math.max(...times) - Math.min(...times)) / 60000,
      meanPriorScore: after.reduce((s, r) => s + (r.credibilityScore ?? 45), 0) / n + (toStatus === "verified" ? 22 : toStatus === "rejected" ? -40 : 0),
      oldestReportAgeHours: 0,
      params: DEFAULT_CONFLATION,
    });

    updates.credibility = credibility;
    updates.credibilityScore = credibility.total;
    updates.status = toStatus;
    if (action === "merge" && body.mergedIntoReportId) updates.mergedIntoReportId = String(body.mergedIntoReportId);

    await db.update(vgiReports).set(updates).where(eq(vgiReports.id, id));

    if (report.accidentId && action !== "edit") {
      const accidentUpdate: Record<string, unknown> = {};
      if (action === "verify") {
        accidentUpdate.status = "verified";
        accidentUpdate.credibilityScore = credibility.total;
      } else if (action === "reject") {
        accidentUpdate.status = "rejected";
      } else if (action === "reopen") {
        accidentUpdate.status = "unverified";
      } else if (action === "merge") {
        accidentUpdate.status = "merged";
      }
      if (Object.keys(accidentUpdate).length) {
        await db.update(accidents).set(accidentUpdate).where(eq(accidents.id, report.accidentId));
      }
    }

    await db.insert(reportVerifications).values({
      reportId: id,
      datasetId: ctx.dataset.id,
      actorId: actor.id,
      actorRole: actor.role,
      action: action === "edit" ? "edited" : action === "flag" ? "flagged" : action === "merge" ? "merged" : action === "reopen" ? "reopened" : action === "verify" ? "verified" : "rejected",
      fromStatus,
      toStatus,
      reason,
      confidenceDelta: credibility.total - (report.credibilityScore ?? 0),
    });

    await writeAudit({
      actor,
      entity: "vgi_reports",
      entityId: id,
      action: `report_${action}`,
      datasetId: ctx.dataset.id,
      severity: action === "reject" ? "warning" : "notice",
      before: { status: fromStatus, credibilityScore: report.credibilityScore },
      after: { status: toStatus, credibilityScore: credibility.total, reason, mergedIntoReportId: updates.mergedIntoReportId ?? null },
      request: req,
    });

    const [fresh] = await db.select().from(vgiReports).where(eq(vgiReports.id, id)).limit(1);
    return json({
      ok: true,
      reportId: id,
      fromStatus,
      toStatus,
      credibility: { breakdown: credibility, score: credibility.total },
      witnessesInCluster: n,
      accidentId: fresh.accidentId,
      report: { id: fresh.id, status: fresh.status, credibilityScore: fresh.credibilityScore, snapPerpDistanceM: fresh.snapPerpDistanceM, mergedIntoReportId: fresh.mergedIntoReportId },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
