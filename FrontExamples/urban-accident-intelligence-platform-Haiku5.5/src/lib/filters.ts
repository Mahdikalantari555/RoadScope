/**
 * Shared analytical filter model. The same specification is used by the map explorer,
 * dashboard, laboratory, risk workspace and API query strings.
 */
import { ACCIDENT_STATUSES, CATEGORY_CODES, SEVERITY_IDS, type AccidentStatus, type BBox, type CategoryCode } from "./domain";

export interface FilterSpec {
  /** Local calendar date (YYYY-MM-DD), inclusive. */
  from: string | null;
  /** Local calendar date (YYYY-MM-DD), inclusive. */
  to: string | null;
  categories: CategoryCode[];
  severities: number[];
  /** Local hour window, inclusive, 0–23. */
  hours: [number, number] | null;
  months: number[];
  /** 0 = Monday … 6 = Sunday. */
  daysOfWeek: number[];
  statuses: AccidentStatus[];
  /** null = all active datasets. */
  datasetIds: number[] | null;
}

export const DEFAULT_FILTERS: FilterSpec = {
  from: null,
  to: null,
  categories: [],
  severities: [],
  hours: null,
  months: [],
  daysOfWeek: [],
  statuses: ["verified"],
  datasetIds: null,
};

export class FilterError extends Error {
  override readonly name = "FilterError";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function csv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvInts(value: string | null, min: number, max: number, label: string): number[] {
  return csv(value).map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < min || n > max) throw new FilterError(`${label} must be integers between ${min} and ${max}`);
    return n;
  });
}

export function parseFilterParams(params: URLSearchParams, opts: { canSeePending: boolean }): FilterSpec {
  const from = params.get("from") || null;
  const to = params.get("to") || null;
  if (from && !DATE_RE.test(from)) throw new FilterError("from must be a date in YYYY-MM-DD format");
  if (to && !DATE_RE.test(to)) throw new FilterError("to must be a date in YYYY-MM-DD format");
  if (from && to && from > to) throw new FilterError("from must not be after to");

  const categories = csv(params.get("categories")).map((c) => {
    if (!(CATEGORY_CODES as readonly string[]).includes(c)) throw new FilterError(`Unknown category '${c}'`);
    return c as CategoryCode;
  });
  const severities = csvInts(params.get("severities"), 1, 4, "severities").filter((s) => (SEVERITY_IDS as readonly number[]).includes(s));
  const hoursRaw = params.get("hours");
  let hours: [number, number] | null = null;
  if (hoursRaw) {
    const [a, b] = hoursRaw.split("-").map((s) => Number(s));
    if (!Number.isInteger(a) || !Number.isInteger(b) || a! < 0 || b! > 23 || a! > b!) {
      throw new FilterError("hours must be a range such as 7-9 (0–23)");
    }
    hours = [a!, b!];
  }
  const months = csvInts(params.get("months"), 1, 12, "months");
  const daysOfWeek = csvInts(params.get("dow"), 0, 6, "dow");
  const requested = csv(params.get("statuses")).filter((s): s is AccidentStatus => (ACCIDENT_STATUSES as readonly string[]).includes(s));
  let statuses: AccidentStatus[] = requested.length ? requested : ["verified"];
  if (!opts.canSeePending) statuses = statuses.filter((s) => s === "verified");
  if (statuses.length === 0) statuses = ["verified"];
  const datasetIdsRaw = params.get("datasets");
  const datasetIds = datasetIdsRaw === null ? null : csvInts(datasetIdsRaw, 1, 2_147_483_647, "datasets");

  return { from, to, categories, severities, hours, months, daysOfWeek, statuses: [...new Set(statuses)], datasetIds };
}

/** Converts a FilterSpec to query-string parameters (inverse of parseFilterParams). */
export function filtersToParams(f: Partial<FilterSpec>, bbox?: BBox | null): URLSearchParams {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.categories?.length) p.set("categories", f.categories.join(","));
  if (f.severities?.length) p.set("severities", f.severities.join(","));
  if (f.hours) p.set("hours", `${f.hours[0]}-${f.hours[1]}`);
  if (f.months?.length) p.set("months", f.months.join(","));
  if (f.daysOfWeek?.length) p.set("dow", f.daysOfWeek.join(","));
  if (f.statuses?.length) p.set("statuses", f.statuses.join(","));
  if (f.datasetIds) p.set("datasets", f.datasetIds.join(","));
  if (bbox) p.set("bbox", bbox.map((v) => v.toFixed(6)).join(","));
  return p;
}

/** Normalises a JSON filter object (e.g. analysis job body) using the same rules as query strings. */
export function normalizeFilterObject(obj: Record<string, unknown>, opts: { canSeePending: boolean }): FilterSpec {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (key === "hours" && Array.isArray(value) && value.length === 2) p.set("hours", `${value[0]}-${value[1]}`);
    else if (key === "statuses" || key === "categories" || key === "severities" || key === "months" || key === "daysOfWeek" || key === "datasetIds") {
      const name = key === "daysOfWeek" ? "dow" : key === "datasetIds" ? "datasets" : key;
      if (Array.isArray(value)) p.set(name, value.map(String).join(","));
    } else if (typeof value === "string" || typeof value === "number") p.set(key, String(value));
  }
  return parseFilterParams(p, opts);
}

export function activeFilterCount(f: FilterSpec): number {
  let n = 0;
  if (f.from || f.to) n++;
  if (f.categories.length) n++;
  if (f.severities.length) n++;
  if (f.hours) n++;
  if (f.months.length) n++;
  if (f.daysOfWeek.length) n++;
  return n;
}

/** Stable key for caching analyses by filter content. */
export function filtersKey(f: FilterSpec): string {
  return JSON.stringify({
    from: f.from,
    to: f.to,
    categories: [...f.categories].sort(),
    severities: [...f.severities].sort(),
    hours: f.hours,
    months: [...f.months].sort(),
    daysOfWeek: [...f.daysOfWeek].sort(),
    statuses: [...f.statuses].sort(),
    datasetIds: f.datasetIds ? [...f.datasetIds].sort() : null,
  });
}
