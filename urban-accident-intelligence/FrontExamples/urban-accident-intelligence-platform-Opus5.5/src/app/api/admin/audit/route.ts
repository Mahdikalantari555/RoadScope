import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { requireAdmin } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async () => {
  await requireAdmin();
  const rows = await db
    .select({ id: auditLogs.id, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, details: auditLogs.details, createdAt: auditLogs.createdAt, actor: users.displayName })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(150);
  return Response.json({ items: rows });
});
