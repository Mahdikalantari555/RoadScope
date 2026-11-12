"use client";
import type { Filters } from "@/lib/domain";

export class ClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = data as { error?: string; details?: unknown } | null;
    throw new ClientError(d?.error ?? `Request failed (${res.status})`, res.status, d?.details);
  }
  return data as T;
}

export function filtersToQuery(f: Filters, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.categories?.length) p.set("categories", f.categories.join(","));
  if (f.severities?.length) p.set("severities", f.severities.join(","));
  if (f.statuses?.length) p.set("statuses", f.statuses.join(","));
  if (f.datasets?.length) p.set("datasets", f.datasets.join(","));
  if (f.hourFrom !== undefined && f.hourTo !== undefined && !(f.hourFrom === 0 && f.hourTo === 23)) {
    p.set("hourFrom", String(f.hourFrom));
    p.set("hourTo", String(f.hourTo));
  }
  if (f.weekdays?.length && f.weekdays.length < 7) p.set("weekdays", f.weekdays.join(","));
  if (f.bbox) p.set("bbox", f.bbox.join(","));
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Body-safe filter object for POST endpoints (drops defaults). */
export function cleanFilters(f: Filters): Filters {
  const out: Filters = {};
  if (f.from) out.from = f.from;
  if (f.to) out.to = f.to;
  if (f.categories?.length) out.categories = f.categories;
  if (f.severities?.length) out.severities = f.severities;
  if (f.statuses?.length) out.statuses = f.statuses;
  if (f.datasets?.length) out.datasets = f.datasets;
  if (f.hourFrom !== undefined && f.hourTo !== undefined && !(f.hourFrom === 0 && f.hourTo === 23)) {
    out.hourFrom = f.hourFrom;
    out.hourTo = f.hourTo;
  }
  if (f.weekdays?.length && f.weekdays.length < 7) out.weekdays = f.weekdays;
  if (f.bbox) out.bbox = f.bbox;
  return out;
}

export const fmt = {
  int: (n: number | null | undefined) => (n === null || n === undefined || Number.isNaN(n) ? "—" : Math.round(n).toLocaleString("en-US")),
  dec: (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d)),
  pct: (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(d)}%`),
  p: (p: number | null | undefined) => (p === null || p === undefined || !Number.isFinite(p) ? "—" : p < 0.001 ? "<0.001" : p.toFixed(3)),
  dt: (v: string | number | Date) => new Date(v).toLocaleString("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
  date: (v: string | number | Date) => new Date(v).toLocaleDateString("en-GB", { timeZone: "Europe/Vienna", year: "numeric", month: "short", day: "2-digit" }),
};
