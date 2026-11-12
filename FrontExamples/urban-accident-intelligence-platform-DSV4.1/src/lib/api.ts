import { sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { getSession, type Role, type Session } from "./auth";

export function jsonOk(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function jsonError(message: string, status = 400, details?: unknown): Response {
  return Response.json({ error: message, details }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requireSession(roles?: Role[]): Promise<{ session: Session } | { response: Response }> {
  const session = await getSession();
  if (!session) return { response: jsonError("Authentication required. Sign in to continue.", 401) };
  if (roles && !roles.includes(session.role)) {
    return { response: jsonError(`Requires role: ${roles.join(" or ")}.`, 403) };
  }
  return { session };
}

export async function logAudit(entry: {
  actor: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actor: entry.actor,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      detail: entry.detail ?? {},
    });
  } catch (error) {
    console.error("audit log failed", error);
  }
}

export function searchParamsOf(request: Request): Record<string, string | string[]> {
  const url = new URL(request.url);
  const out: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  });
  return out;
}

export async function paginate<T>(
  rows: T[],
  page: number,
  pageSize: number,
): Promise<{ rows: T[]; page: number; pageSize: number; total: number; pages: number }> {
  const safeSize = Math.min(Math.max(pageSize, 1), 250);
  const pages = Math.max(1, Math.ceil(rows.length / safeSize));
  const safePage = Math.min(Math.max(page, 1), pages);
  return {
    rows: rows.slice((safePage - 1) * safeSize, safePage * safeSize),
    page: safePage,
    pageSize: safeSize,
    total: rows.length,
    pages,
  };
}

export async function databaseReady(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export function parseNumber(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
