import { ZodError, type ZodType } from "zod";
import type { Filters } from "@/lib/domain";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function log(level: "info" | "warn" | "error", msg: string, meta: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Wrap a route handler with uniform error handling + structured logging. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return Response.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ZodError)
        return Response.json({ error: "Validation failed", details: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
      log("error", "Unhandled API error", { error: e instanceof Error ? e.stack : String(e) });
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Request body must be valid JSON");
  }
  return schema.parse(raw);
}

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined);

/** Parse the shared filter vocabulary from URL search params. */
export function parseFilters(sp: URLSearchParams): Filters {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v === null || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new ApiError(400, `Parameter ${k} must be numeric`);
    return n;
  };
  const bbox = list(sp.get("bbox"))?.map(Number);
  if (bbox && (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)))) throw new ApiError(400, "bbox must be minLon,minLat,maxLon,maxLat");
  const dateOk = (v: string | null) => {
    if (!v) return undefined;
    if (Number.isNaN(Date.parse(v))) throw new ApiError(400, `Invalid date: ${v}`);
    return v;
  };
  return {
    from: dateOk(sp.get("from")),
    to: dateOk(sp.get("to")),
    categories: list(sp.get("categories")),
    severities: list(sp.get("severities")),
    statuses: list(sp.get("statuses")),
    datasets: list(sp.get("datasets"))?.map(Number).filter(Number.isFinite),
    hourFrom: num("hourFrom"),
    hourTo: num("hourTo"),
    weekdays: list(sp.get("weekdays"))?.map(Number).filter(Number.isFinite),
    bbox: bbox as Filters["bbox"],
  };
}
