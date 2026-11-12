/** Shared accident-filter contract used by every API route and UI surface. */
import { and, between, eq, gte, inArray, lte, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { accidents } from "@/db/schema";
import type { BBox } from "./geo";

export type StatusFilter = "verified" | "reported" | "rejected" | "duplicate";

export const ALL_STATUSES: StatusFilter[] = ["verified", "reported", "rejected", "duplicate"];

export type AccidentFilters = {
  from?: string;
  to?: string;
  status: StatusFilter[];
  categories: string[];
  severities: number[];
  districts: string[];
  hourFrom: number;
  hourTo: number;
  dows: number[];
  bbox?: BBox;
  segmentId?: string;
  datasetId?: number;
};

export type FilterInput = Record<string, string | string[] | undefined>;

function csv(value: string | string[] | undefined): string[] {
  if (!value) return [];
  const raw = Array.isArray(value) ? value.join(",") : value;
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseFilters(input: FilterInput): AccidentFilters {
  const statusValues = csv(input.status) as StatusFilter[];
  const status = statusValues.length > 0 ? statusValues.filter((s) => ALL_STATUSES.includes(s)) : (["verified", "reported"] as StatusFilter[]);
  const severities = csv(input.severity)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 4);
  const dows = csv(input.dow)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const hourFrom = clampInt(input.hourFrom, 0, 23, 0);
  const hourTo = clampInt(input.hourTo, 0, 23, 23);
  const minLng = num(input.minLng);
  const minLat = num(input.minLat);
  const maxLng = num(input.maxLng);
  const maxLat = num(input.maxLat);
  const bbox =
    minLng !== undefined && minLat !== undefined && maxLng !== undefined && maxLat !== undefined
      ? { minLng, minLat, maxLng, maxLat }
      : undefined;
  return {
    from: typeof input.from === "string" && input.from ? input.from : undefined,
    to: typeof input.to === "string" && input.to ? input.to : undefined,
    status: status.length > 0 ? status : ["verified"],
    categories: csv(input.category),
    severities,
    districts: csv(input.district),
    hourFrom,
    hourTo,
    dows,
    bbox,
    segmentId: typeof input.segmentId === "string" && input.segmentId ? input.segmentId : undefined,
    datasetId: num(input.datasetId),
  };
}

function num(value: string | string[] | undefined): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInt(value: string | string[] | undefined, min: number, max: number, fallback: number): number {
  const n = num(value);
  if (n === undefined) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** SQL predicate shared by list, statistics and analysis endpoints. */
export function accidentWhere(filters: AccidentFilters): SQL {
  const conditions: SQL[] = [];
  if (filters.from) conditions.push(gte(accidents.occurredAt, new Date(filters.from)));
  if (filters.to) conditions.push(lte(accidents.occurredAt, new Date(filters.to)));
  if (filters.status.length > 0) conditions.push(inArray(accidents.status, filters.status));
  else conditions.push(ne(accidents.status, "duplicate"));
  if (filters.categories.length > 0) conditions.push(inArray(accidents.categoryCode, filters.categories));
  if (filters.severities.length > 0) conditions.push(inArray(accidents.severityCode, filters.severities));
  if (filters.districts.length > 0) conditions.push(inArray(accidents.district, filters.districts));
  if (filters.dows.length > 0) conditions.push(inArray(accidents.dow, filters.dows));
  if (filters.hourFrom > 0 || filters.hourTo < 23) {
    conditions.push(
      filters.hourFrom <= filters.hourTo
        ? between(accidents.hour, filters.hourFrom, filters.hourTo)
        : sql`(${accidents.hour} >= ${filters.hourFrom} or ${accidents.hour} <= ${filters.hourTo})`,
    );
  }
  if (filters.bbox) {
    conditions.push(
      gte(accidents.lat, filters.bbox.minLat),
      lte(accidents.lat, filters.bbox.maxLat),
      gte(accidents.lng, filters.bbox.minLng),
      lte(accidents.lng, filters.bbox.maxLng),
    );
  }
  if (filters.segmentId) conditions.push(eq(accidents.roadSegmentId, filters.segmentId));
  if (filters.datasetId !== undefined) conditions.push(eq(accidents.datasetId, filters.datasetId));
  if (!filters.status.includes("duplicate")) conditions.push(notInArray(accidents.status, ["duplicate"]));
  return and(...conditions) as SQL;
}

export function filtersToQuery(filters: Partial<AccidentFilters>): string {
  const params = new URLSearchParams();
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.status?.length) params.set("status", filters.status.join(","));
  if (filters.categories?.length) params.set("category", filters.categories.join(","));
  if (filters.severities?.length) params.set("severity", filters.severities.join(","));
  if (filters.districts?.length) params.set("district", filters.districts.join(","));
  if (filters.dows?.length) params.set("dow", filters.dows.join(","));
  if (filters.hourFrom !== undefined && filters.hourFrom > 0) params.set("hourFrom", String(filters.hourFrom));
  if (filters.hourTo !== undefined && filters.hourTo < 23) params.set("hourTo", String(filters.hourTo));
  if (filters.segmentId) params.set("segmentId", filters.segmentId);
  return params.toString();
}
