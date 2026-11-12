import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import type { SessionUser } from "@/lib/api-types";
import { hashIp } from "./auth";
import { logger } from "./logger";

export interface AuditEntry {
  actor: SessionUser | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  changes?: Record<string, unknown>;
  ip?: string | null;
}

/** Appends an immutable audit record. IP addresses are stored only as keyed hashes. */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: entry.actor?.id ?? null,
    actorEmail: entry.actor?.email ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId === null || entry.entityId === undefined ? null : String(entry.entityId),
    changes: entry.changes ?? {},
    ipHash: entry.ip ? hashIp(entry.ip) : null,
  });
  logger.info("audit", { action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null });
}
