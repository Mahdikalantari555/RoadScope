import { z } from "zod";
import { CATEGORY_CODES } from "@/lib/domain";
import { parseFilterParams } from "@/lib/filters";
import { accidentPatchSchema, reportSchema, reviewSchema } from "@/lib/validation";
import { getSessionUser } from "@/server/auth";
import { addAttachment, accidentGeoJson, checkDuplicates, createCitizenReport, getAccidentDetail, listAccidents, patchAccident, readAttachment, reviewAccident, trackReport } from "@/server/accidents";
import { ApiError, clientIp, jsonResponse, parseBBox, parsePagination, readJsonBody, type RouteContext } from "@/server/http";
import { requireAdmin } from "@/server/auth";
import { parseId } from "./router";

const probeSchema = z.object({
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  occurredLocal: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  categoryCode: z.enum(CATEGORY_CODES),
});

const SORTS = ["occurred", "reported", "status", "severity"] as const;

function idParam(ctx: RouteContext): number {
  try {
    return parseId(ctx.params.id ?? "");
  } catch {
    throw new ApiError(422, "invalid_id", "Identifier must be a positive integer");
  }
}

export const accidentHandlers = {
  async list(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const filters = parseFilterParams(ctx.url.searchParams, { canSeePending: viewer?.role === "admin" });
    const { page, pageSize } = parsePagination(ctx.url, { page: 1, pageSize: 25 }, 100);
    const sortRaw = ctx.url.searchParams.get("sort") ?? "occurred";
    const sort = (SORTS as readonly string[]).includes(sortRaw) ? (sortRaw as (typeof SORTS)[number]) : "occurred";
    const order = ctx.url.searchParams.get("order") === "asc" ? "asc" : "desc";
    return jsonResponse(await listAccidents(filters, { page, pageSize, sort, order, bbox: parseBBox(ctx.url) }));
  },

  async geojson(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const filters = parseFilterParams(ctx.url.searchParams, { canSeePending: viewer?.role === "admin" });
    const limit = Math.min(50000, Math.max(1, Number(ctx.url.searchParams.get("limit") ?? 20000)));
    return jsonResponse(await accidentGeoJson(filters, parseBBox(ctx.url), limit));
  },

  async createReport(ctx: RouteContext) {
    const input = reportSchema.parse(await readJsonBody(ctx.req));
    return jsonResponse(await createCitizenReport(input, clientIp(ctx.req)), { status: 201 });
  },

  async checkDuplicates(ctx: RouteContext) {
    const input = probeSchema.parse(await readJsonBody(ctx.req));
    return jsonResponse({ candidates: await checkDuplicates(input) });
  },

  async track(ctx: RouteContext) {
    const code = ctx.url.searchParams.get("code")?.trim();
    if (!code) throw new ApiError(422, "validation_error", "A tracking code is required");
    return jsonResponse(await trackReport(code));
  },

  async detail(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    return jsonResponse(await getAccidentDetail(idParam(ctx), viewer, ctx.url.searchParams.get("code")));
  },

  async patch(ctx: RouteContext) {
    const admin = requireAdmin(await getSessionUser(ctx.req));
    const input = accidentPatchSchema.parse(await readJsonBody(ctx.req));
    return jsonResponse(await patchAccident(idParam(ctx), input, admin, clientIp(ctx.req)));
  },

  async review(ctx: RouteContext) {
    const admin = requireAdmin(await getSessionUser(ctx.req));
    const input = reviewSchema.parse(await readJsonBody(ctx.req));
    return jsonResponse(await reviewAccident(idParam(ctx), input, admin, clientIp(ctx.req)));
  },

  async upload(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw new ApiError(400, "invalid_form", "Expected multipart/form-data with a 'file' field");
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(422, "validation_error", "A 'file' field is required");
    const trackingCode = String(form.get("trackingCode") ?? "") || null;
    const created = await addAttachment(idParam(ctx), file, {
      admin: viewer?.role === "admin" ? viewer : null,
      trackingCode,
      ip: clientIp(ctx.req),
    });
    return jsonResponse(created, { status: 201 });
  },

  async attachment(ctx: RouteContext) {
    const viewer = await getSessionUser(ctx.req);
    const id = Number(ctx.params.id);
    const { bytes, mimeType, filename } = await readAttachment(id, { admin: viewer, trackingCode: ctx.url.searchParams.get("code") });
    return new Response(Uint8Array.from(bytes), {
      headers: {
        "content-type": mimeType,
        "content-disposition": `inline; filename="${filename}"`,
        "cache-control": "private, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  },
};

export type { SessionUserLike };
type SessionUserLike = { id: number };
