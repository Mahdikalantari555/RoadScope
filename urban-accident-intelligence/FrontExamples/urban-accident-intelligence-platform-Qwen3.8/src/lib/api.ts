/** API-layer helpers: validation, error envelopes, query parsing. */

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, { headers: { "cache-control": "no-store" }, ...init });
}

export function fail(status: number, error: string, detail?: unknown): Response {
  return json({ error, detail }, { status });
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function handleApiError(err: unknown): Response {
  if (err instanceof ApiError) return fail(err.status, err.message, err.detail);
  if (err instanceof Response) return err;
  const message = err instanceof Error ? err.message : String(err);
  return fail(500, "internal_error", message);
}

export function queryString(url: string): URLSearchParams {
  return new URL(url, "http://internal").searchParams;
}

export function num(q: URLSearchParams, key: string, fallback: number): number {
  const raw = q.get(key);
  if (raw === null || raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export function numOrUndefined(q: URLSearchParams, key: string): number | undefined {
  const raw = q.get(key);
  if (raw === null || raw === "") return undefined;
  const v = Number(raw);
  return Number.isFinite(v) ? v : undefined;
}

export function bool(q: URLSearchParams, key: string, fallback: boolean): boolean {
  const raw = q.get(key);
  if (raw === null) return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export function csv(q: URLSearchParams, key: string): string[] | undefined {
  const raw = q.get(key);
  if (!raw) return undefined;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function bboxParam(q: URLSearchParams): [number, number, number, number] | undefined {
  const raw = q.get("bbox");
  if (!raw) return undefined;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p))) throw new ApiError(400, "invalid_bbox", "bbox must be minLon,minLat,maxLon,maxLat");
  if (parts[0] < -180 || parts[2] > 180 || parts[1] < -90 || parts[3] > 90) throw new ApiError(400, "bbox_out_of_bounds");
  if (parts[0] > parts[2] || parts[1] > parts[3]) throw new ApiError(400, "bbox_min_greater_than_max");
  return [parts[0], parts[1], parts[2], parts[3]] as [number, number, number, number];
}

export function requireBody<T>(raw: unknown, check: (v: any) => T): T {
  return check(raw);
}

/** Coordinate bounds + temporal sanity checks for VGI ingestion (US-2.2). */
export function validateCoordinates(lon: unknown, lat: unknown): { lon: number; lat: number } {
  const l1 = Number(lon);
  const l2 = Number(lat);
  if (!Number.isFinite(l1) || !Number.isFinite(l2)) throw new ApiError(400, "invalid_coordinates", "lon/lat must be finite numbers");
  if (l1 < -180 || l1 > 180) throw new ApiError(400, "longitude_out_of_bounds", l1);
  if (l2 < -90 || l2 > 90) throw new ApiError(400, "latitude_out_of_bounds", l2);
  return { lon: l1, lat: l2 };
}

export function validateTimestamp(value: unknown, field: string, now = Date.now()): Date {
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new ApiError(400, `invalid_${field}`, value);
  if (d.getTime() > now + 5 * 60000) throw new ApiError(400, `${field}_in_future`, d.toISOString());
  if (d.getTime() < now - 5 * 365 * 86400000) throw new ApiError(400, `${field}_too_old`, d.toISOString());
  return d;
}

export async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "invalid_json_body");
  }
}
