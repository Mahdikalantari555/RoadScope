/** RBAC + immutable audit logging helpers (server-side only). */
import { db } from "@/db";
import { desc, eq } from "drizzle-orm";
import { auditLogs, users } from "@/db/schema";
import { PERSONAS } from "@/lib/domain/taxonomy";

export type Role = (typeof PERSONAS)[number]["role"];

export interface Actor {
  id: string | null;
  role: Role;
  permissions: string[];
  displayName: string;
}

const ROLE_PERMISSIONS: Record<Role, string[]> = {
  administrator: ["*"],
  simulation_scientist: ["dataset:read", "dataset:write", "simulate:run", "ground_truth:read", "analysis:run"],
  data_steward: ["dataset:read", "report:read", "report:verify", "report:merge", "report:reject", "audit:read"],
  researcher: ["dataset:read", "report:read", "analysis:run", "analysis:export", "ground_truth:read"],
  safety_engineer: ["dataset:read", "report:read", "analysis:run", "risk:read", "risk:configure"],
  mobility_analyst: ["dataset:read", "report:read", "analysis:run", "risk:read", "export:read"],
  citizen_reporter: ["report:create", "report:read_own"],
};

/**
 * Resolves the acting principal. The platform is a research demonstrator: the
 * role is taken from the `x-uai-role` header (default mobility_analyst) and is
 * always re-validated against the permission matrix on the server. No secret is
 * ever read from the client and no permission is trusted from the request body.
 */
export function resolveActor(req: Request): Actor {
  const header = req.headers.get("x-uai-role");
  const role = (Object.keys(ROLE_PERMISSIONS) as Role[]).find((r) => r === header) ?? "mobility_analyst";
  const userId = req.headers.get("x-uai-user-id");
  return { id: userId, role, permissions: ROLE_PERMISSIONS[role], displayName: role };
}

export function can(actor: Actor, permission: string): boolean {
  return actor.permissions.includes("*") || actor.permissions.includes(permission);
}

export function requirePermission(actor: Actor, permission: string): void {
  if (!can(actor, permission)) {
    throw new Response(JSON.stringify({ error: "forbidden", required: permission, role: actor.role }), { status: 403 });
  }
}

export async function writeAudit(entry: {
  actor: Actor;
  entity: string;
  entityId?: string | null;
  action: string;
  datasetId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  severity?: "info" | "notice" | "warning" | "critical";
  request?: Request;
}): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actor.id,
    actorRole: entry.actor.role,
    entity: entry.entity,
    entityId: entry.entityId ?? null,
    action: entry.action,
    datasetId: entry.datasetId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    severity: entry.severity ?? "info",
    ipAddress: entry.request?.headers.get("x-forwarded-for") ?? null,
    userAgent: entry.request?.headers.get("user-agent") ?? null,
  });
}

export async function recentAudit(limit = 60, datasetId?: string) {
  return db
    .select()
    .from(auditLogs)
    .where(datasetId ? eq(auditLogs.datasetId, datasetId) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function resolveUserByEmail(email: string) {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0] ?? null;
}
