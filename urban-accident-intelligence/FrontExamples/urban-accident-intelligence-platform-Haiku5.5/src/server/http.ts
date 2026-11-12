/**
 * HTTP helpers: typed errors, JSON responses, uniform error envelope, request parsing.
 */
import { ZodError } from "zod";
import type { BBox } from "@/lib/domain";
import { logger } from "./logger";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface RouteContext {
  req: Request;
  params: Record<string, string>;
  url: URL;
  requestId: string;
}

export function jsonResponse(data: unknown, init: { status?: number; headers?: Record<string, string | string[]> } = {}): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  for (const [key, value] of Object.entries(init.headers ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function errorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return jsonResponse({ error: { code: error.code, message: error.message, details: error.details ?? null, requestId } }, { status: error.status });
  }
  if (error instanceof ZodError) {
    const details = error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return jsonResponse(
      { error: { code: "validation_error", message: details[0]?.message ?? "Invalid input", details, requestId } },
      { status: 422 },
    );
  }
  if (error instanceof Error && error.name === "FilterError") {
    return jsonResponse({ error: { code: "invalid_filter", message: error.message, details: null, requestId } }, { status: 422 });
  }
  logger.error("unhandled_error", { requestId, error });
  return jsonResponse({ error: { code: "internal_error", message: "An unexpected error occurred", details: null, requestId } }, { status: 500 });
}

export async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError(400, "invalid_body", "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

export function parsePagination(url: URL, defaults = { page: 1, pageSize: 25 }, max = 100) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? `${defaults.page}`, 10) || 1);
  const pageSize = Math.min(max, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? `${defaults.pageSize}`, 10) || defaults.pageSize));
  return { page, pageSize };
}

export function parseBBox(url: URL): BBox | null {
  const raw = url.searchParams.get("bbox");
  if (!raw) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) throw new ApiError(422, "invalid_bbox", "bbox must be minLon,minLat,maxLon,maxLat");
  const [minLon, minLat, maxLon, maxLat] = parts as [number, number, number, number];
  if (minLon > maxLon || minLat > maxLat || Math.abs(minLon) > 180 || Math.abs(maxLon) > 180 || Math.abs(minLat) > 90 || Math.abs(maxLat) > 90) {
    throw new ApiError(422, "invalid_bbox", "bbox bounds are inconsistent or out of range");
  }
  return [minLon, minLat, maxLon, maxLat];
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
