import { accidents } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";

export interface Filters {
  from?: Date; to?: Date; hours?: number[]; dows?: number[]; severityIds?: number[]; categoryIds?: number[];
  statuses?: string[]; segmentIds?: number[]; bbox?: [number, number, number, number]; weather?: string[];
}

export function parseFilters(sp: URLSearchParams): Filters {
  const ints = (k: string) => sp.get(k)?.split(",").filter(Boolean).map(Number).filter((n) => !isNaN(n));
  const f: Filters = {};
  if (sp.get("from")) f.from = new Date(sp.get("from")!);
  if (sp.get("to")) f.to = new Date(sp.get("to")!);
  f.hours = ints("hours"); f.dows = ints("dows"); f.severityIds = ints("severity"); f.categoryIds = ints("category"); f.segmentIds = ints("segments");
  f.statuses = sp.get("status")?.split(",").filter(Boolean) ?? ["verified", "raw", "flagged"];
  f.weather = sp.get("weather")?.split(",").filter(Boolean);
  const bb = sp.get("bbox")?.split(",").map(Number);
  if (bb && bb.length === 4 && bb.every((n) => !isNaN(n))) f.bbox = bb as Filters["bbox"];
  return f;
}

export function filterSQL(sourceId: number, f: Filters): SQL {
  const parts: (SQL | undefined)[] = [eq(accidents.sourceId, sourceId), isNull(accidents.canonicalId)];
  if (f.from) parts.push(gte(accidents.occurredAt, f.from));
  if (f.to) parts.push(lte(accidents.occurredAt, f.to));
  if (f.hours?.length) parts.push(sql`extract(hour from ${accidents.occurredAt} at time zone 'UTC')::int in (${sql.join(f.hours.map((h) => sql`${h}`), sql`, `)})`);
  if (f.dows?.length) parts.push(sql`extract(dow from ${accidents.occurredAt} at time zone 'UTC')::int in (${sql.join(f.dows.map((h) => sql`${h}`), sql`, `)})`);
  if (f.severityIds?.length) parts.push(inArray(accidents.severityId, f.severityIds));
  if (f.categoryIds?.length) parts.push(inArray(accidents.categoryId, f.categoryIds));
  if (f.statuses?.length) parts.push(inArray(accidents.status, f.statuses));
  if (f.segmentIds?.length) parts.push(inArray(accidents.segmentId, f.segmentIds));
  if (f.weather?.length) parts.push(inArray(accidents.weather, f.weather));
  if (f.bbox) { const [w, s, e, n] = f.bbox; parts.push(gte(accidents.rawLon, w), lte(accidents.rawLon, e), gte(accidents.rawLat, s), lte(accidents.rawLat, n)); }
  return and(...parts)!;
}
