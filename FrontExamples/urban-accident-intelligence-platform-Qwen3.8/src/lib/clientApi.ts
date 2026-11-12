"use client";

/** Typed fetch helpers for the REST/GeoJSON contract layer. */

export async function apiGet<T>(url: string, role?: string): Promise<T> {
  const res = await fetch(url, { headers: role ? { "x-uai-role": role } : undefined, cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${await safeText(res)}`);
  return (await res.json()) as T;
}

export async function apiPost<T>(url: string, body: unknown, role?: string): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(role ? { "x-uai-role": role } : {}) },
    body: JSON.stringify(body ?? {}),
    cache: "no-store",
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof payload?.error === "string" ? `${res.status} ${payload.error}${payload.detail ? ` — ${JSON.stringify(payload.detail)}` : ""}` : `${res.status}`);
  return payload as T;
}

async function safeText(res: Response): Promise<string> {
  try {
    const p = await res.json();
    return p?.error ? `${p.error}${p.detail ? ` (${JSON.stringify(p.detail)})` : ""}` : res.statusText;
  } catch {
    return res.statusText;
  }
}

export interface GeoFeature {
  type: "Feature";
  id?: string | number;
  geometry: { type: "Point" | "LineString" | "Polygon"; coordinates: any };
  properties: Record<string, any>;
}

export interface GeoCollection {
  type: "FeatureCollection";
  crs?: { properties: { name: string } };
  features: GeoFeature[];
  bbox?: [number, number, number, number];
}

export function useQuery(filters: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    p.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function fmt(v: unknown, digits = 2): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toFixed(digits);
}

export function fmtPct(v: unknown, digits = 1): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${(n * 100).toFixed(digits)}%` : "—";
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
