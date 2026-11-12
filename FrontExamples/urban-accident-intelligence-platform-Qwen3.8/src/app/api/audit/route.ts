import { db } from "@/db";
import { desc, eq } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { handleApiError, json, num, queryString } from "@/lib/api";
import { resolveActor, requirePermission } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/audit — immutable audit trail (RBAC: audit:read or administrator). */
export async function GET(req: Request) {
  try {
    const actor = resolveActor(req);
    requirePermission(actor, "audit:read");
    const q = queryString(req.url);
    const limit = Math.min(500, num(q, "limit", 80));
    const datasetId = q.get("datasetId") ?? undefined;
    const entity = q.get("entity") ?? undefined;
    const rows = await db
      .select()
      .from(auditLogs)
      .where(datasetId ? eq(auditLogs.datasetId, datasetId) : entity ? eq(auditLogs.entity, entity) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
    return json({
      count: rows.length,
      entries: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        actorId: r.actorId,
        actorRole: r.actorRole,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        datasetId: r.datasetId,
        severity: r.severity,
        before: r.before,
        after: r.after,
      })),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
