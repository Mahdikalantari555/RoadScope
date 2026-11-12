import { z } from "zod";
import { ACCIDENT_STATUSES, CATEGORY_CODES, CATEGORY_META, QUALITY_FLAGS, QUALITY_FLAG_META, ROAD_CLASS_META, ROAD_CLASSES, SCENARIO_IDS, SCENARIO_META, SEVERITY_IDS, SEVERITY_META, STUDY_AREA } from "@/lib/domain";
import { coverageBBox } from "@/lib/geo";
import { datasetPatchSchema, importDatasetSchema, syntheticDatasetSchema } from "@/lib/validation";
import type { AuditEntryView, MetaResponse } from "@/lib/api-types";
import { authenticate, checkLoginRate, clearLoginRate, clearSessionCookieHeader, createSession, destroySession, getSessionUser, requireAdmin, sessionCookieHeader } from "@/server/auth";
import { deleteDataset, generateDataset, importDataset, listDatasets, setDatasetActive } from "@/server/datasets";
import { ApiError, clientIp, jsonResponse, readJsonBody, type RouteContext } from "@/server/http";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { desc } from "drizzle-orm";
import { parseId } from "./router";

const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });

export const adminHandlers = {
  async meta(ctx: RouteContext) {
    const user = await getSessionUser(ctx.req);
    const body: MetaResponse = {
      study: {
        id: STUDY_AREA.id,
        name: STUDY_AREA.name,
        disclaimer: STUDY_AREA.disclaimer,
        timeZone: STUDY_AREA.timeZone,
        center: STUDY_AREA.center,
        coverageBBox: coverageBBox(),
        utmEpsg: STUDY_AREA.utmEpsg,
      },
      categories: CATEGORY_CODES.map((code) => ({ code, label: CATEGORY_META[code].label, description: CATEGORY_META[code].description, colorHex: CATEGORY_META[code].colorHex })),
      severities: SEVERITY_IDS.map((id) => ({ id, code: SEVERITY_META[id].code, label: SEVERITY_META[id].label, weight: SEVERITY_META[id].weight, colorHex: SEVERITY_META[id].colorHex, description: SEVERITY_META[id].description })),
      statuses: [...ACCIDENT_STATUSES],
      scenarios: SCENARIO_IDS.map((id) => ({ id, label: SCENARIO_META[id].label, description: SCENARIO_META[id].description })),
      roadClasses: ROAD_CLASSES.map((id) => ({ id, label: ROAD_CLASS_META[id].label, speedKmh: ROAD_CLASS_META[id].speedKmh, lanes: ROAD_CLASS_META[id].lanes, colorHex: ROAD_CLASS_META[id].colorHex, width: ROAD_CLASS_META[id].width })),
      qualityFlags: QUALITY_FLAGS.map((code) => ({ code, label: QUALITY_FLAG_META[code] })),
      user,
    };
    return jsonResponse(body);
  },

  async me(ctx: RouteContext) {
    return jsonResponse({ user: await getSessionUser(ctx.req) });
  },

  async login(ctx: RouteContext) {
    const ip = clientIp(ctx.req);
    checkLoginRate(ip);
    const { email, password } = loginSchema.parse(await readJsonBody(ctx.req));
    const user = await authenticate(email, password);
    if (!user) throw new ApiError(401, "invalid_credentials", "Email or password is incorrect");
    clearLoginRate(ip);
    const token = await createSession(user.id);
    return jsonResponse({ user }, { headers: { "set-cookie": [sessionCookieHeader(token)] } });
  },

  async logout(ctx: RouteContext) {
    await destroySession(ctx.req);
    return jsonResponse({ ok: true }, { headers: { "set-cookie": [clearSessionCookieHeader()] } });
  },

  async listDatasets(ctx: RouteContext) {
    const user = await getSessionUser(ctx.req);
    return jsonResponse({ items: await listDatasets(user?.role === "admin") });
  },

  async generateDataset(ctx: RouteContext) {
    const admin = requireAdmin(await getSessionUser(ctx.req));
    const input = syntheticDatasetSchema.parse(await readJsonBody(ctx.req));
    return jsonResponse(await generateDataset(input, admin, clientIp(ctx.req)), { status: 201 });
  },

  async importDataset(ctx: RouteContext) {
    const admin = requireAdmin(await getSessionUser(ctx.req));
    const input = importDatasetSchema.parse(await readJsonBody(ctx.req));
    return jsonResponse(await importDataset(input, admin, clientIp(ctx.req)), { status: 201 });
  },

  async patchDataset(ctx: RouteContext) {
    const admin = requireAdmin(await getSessionUser(ctx.req));
    const input = datasetPatchSchema.parse(await readJsonBody(ctx.req));
    const id = parseId(ctx.params.id ?? "");
    return jsonResponse(await setDatasetActive(id, input.isActive, admin, clientIp(ctx.req)));
  },

  async deleteDataset(ctx: RouteContext) {
    const admin = requireAdmin(await getSessionUser(ctx.req));
    await deleteDataset(parseId(ctx.params.id ?? ""), admin, clientIp(ctx.req));
    return jsonResponse({ ok: true });
  },

  async audit(ctx: RouteContext) {
    requireAdmin(await getSessionUser(ctx.req));
    const limit = Math.min(500, Math.max(1, Number(ctx.url.searchParams.get("limit") ?? 100)));
    const rows = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit);
    const items: AuditEntryView[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorEmail: r.actorEmail,
      changes: r.changes,
      createdAt: r.createdAt.toISOString(),
    }));
    return jsonResponse({ items });
  },
};
