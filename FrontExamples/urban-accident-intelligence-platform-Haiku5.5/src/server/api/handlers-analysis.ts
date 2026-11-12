import { ANALYSIS_TYPES, type AnalysisType } from "@/lib/domain";
import { ANALYSIS_DEFS } from "@/lib/catalog";
import { normalizeFilterObject, parseFilterParams } from "@/lib/filters";
import { analysisJobSchema, paramsSchemaFor, validateRiskWeights } from "@/lib/validation";
import { getSessionUser } from "@/server/auth";
import { dashboard, qualityReport, segmentDetail, segmentsLayer } from "@/server/stats";
import { ApiError, jsonResponse, readJsonBody, type RouteContext } from "@/server/http";
import { exportJob, getJob, listJobs, submitJob } from "@/server/jobs";
import { loadNetwork } from "@/server/geo-data";
import { requireAdmin } from "@/server/auth";
import { networkSummary } from "@/server/datasets";
import { parseId } from "./router";

function filtersFromUrl(ctx: RouteContext, admin: boolean) {
  return parseFilterParams(ctx.url.searchParams, { canSeePending: admin });
}

export const analysisHandlers = {
  async segments(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const admin = viewer?.role === "admin";
    return jsonResponse(await segmentsLayer(filtersFromUrl(ctx, admin), admin));
  },

  async segmentDetail(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const admin = viewer?.role === "admin";
    const id = parseId(ctx.params.id ?? "");
    return jsonResponse(await segmentDetail(id, filtersFromUrl(ctx, admin), admin));
  },

  async dashboard(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const admin = viewer?.role === "admin";
    const f = filtersFromUrl(ctx, admin);
    return jsonResponse(await dashboard(f, admin));
  },

  async quality(ctx: RouteContext) {
    requireAdmin(await getSessionUser(ctx.req));
    return jsonResponse(await qualityReport());
  },

  async network(_ctx: RouteContext) {
    await loadNetwork();
    return jsonResponse(await networkSummary());
  },

  async listJobs(ctx: RouteContext) {
    const limit = Math.min(100, Math.max(1, Number(ctx.url.searchParams.get("limit") ?? 20)));
    return jsonResponse({ items: await listJobs(limit) });
  },

  async createJob(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const admin = viewer?.role === "admin";
    const body = analysisJobSchema.parse(await readJsonBody(ctx.req));
    const type = body.type as AnalysisType;
    if (!(ANALYSIS_TYPES as readonly string[]).includes(type)) throw new ApiError(422, "validation_error", "Unknown analysis type");
    const params = paramsSchemaFor(type).parse(body.params) as Record<string, number | string>;
    if (type === "risk") {
      const weightError = validateRiskWeights(params);
      if (weightError) throw new ApiError(422, "validation_error", weightError);
    }
    const filters = normalizeFilterObject(body.filters, { canSeePending: admin });
    const job = await submitJob({ type, params, filters, user: viewer });
    return jsonResponse(job, { status: job.cached ? 200 : 202 });
  },

  async getJob(ctx: RouteContext) {
    return jsonResponse(await getJob(ctx.params.id ?? ""));
  },

  async exportJob(ctx: RouteContext) {
    const format = ctx.url.searchParams.get("format") === "csv" ? "csv" : "geojson";
    const file = await exportJob(ctx.params.id ?? "", format);
    return new Response(file.body, {
      headers: {
        "content-type": file.contentType,
        "content-disposition": `attachment; filename="${file.filename}"`,
        "cache-control": "no-store",
      },
    });
  },
};

export { ANALYSIS_DEFS };
