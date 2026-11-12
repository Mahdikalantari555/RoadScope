/**
 * Serialisation boundary: metric CRS → WGS84 GeoJSON (RFC 7946).
 * Nothing upstream of this module ever emits geographic coordinates.
 */
import type { ProjectedCrs } from "@/lib/geo/projection";
import { toWgs84, toUtm as toUtmLocal } from "@/lib/geo/projection";

export interface Feature {
  type: "Feature";
  id?: string | number;
  geometry:
    | { type: "Point"; coordinates: [number, number] }
    | { type: "LineString"; coordinates: Array<[number, number]> }
    | { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
  properties: Record<string, unknown>;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  crs: { type: "name"; properties: { name: string } };
  features: Feature[];
  bbox?: [number, number, number, number];
}

export function fc(crs: ProjectedCrs, features: Feature[]): FeatureCollection {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const f of features) {
    const coords = collectCoords(f.geometry);
    for (const [lon, lat] of coords) {
      if (lon < minX) minX = lon;
      if (lon > maxX) maxX = lon;
      if (lat < minY) minY = lat;
      if (lat > maxY) maxY = lat;
    }
  }
  return {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } },
    features,
    bbox: Number.isFinite(minX) ? [round6(minX), round6(minY), round6(maxX), round6(maxY)] : undefined,
  };
}

function collectCoords(g: Feature["geometry"]): Array<[number, number]> {
  if (g.type === "Point") return [g.coordinates];
  if (g.type === "LineString") return g.coordinates;
  return g.coordinates.flat();
}

export function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

export function point(crs: ProjectedCrs, x: number, y: number): [number, number] {
  const p = toWgs84(x, y, crs);
  return [round6(p.lon), round6(p.lat)];
}

export function pointFeature(crs: ProjectedCrs, x: number, y: number, properties: Record<string, unknown>, id?: string): Feature {
  return { type: "Feature", id, geometry: { type: "Point", coordinates: point(crs, x, y) }, properties };
}

export function lineFeature(
  crs: ProjectedCrs,
  shape: Array<[number, number]>,
  properties: Record<string, unknown>,
  id?: string,
): Feature {
  return {
    type: "Feature",
    id,
    geometry: { type: "LineString", coordinates: shape.map(([x, y]) => point(crs, x, y)) },
    properties,
  };
}

export function polygonFeature(
  crs: ProjectedCrs,
  ring: Array<[number, number]>,
  properties: Record<string, unknown>,
  id?: string,
): Feature {
  const closed = ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]) ? [...ring, ring[0]] : ring;
  return {
    type: "Feature",
    id,
    geometry: { type: "Polygon", coordinates: [closed.map(([x, y]) => point(crs, x, y))] },
    properties,
  };
}

/** Web Mercator (EPSG:3857) helper for client-side canvas rendering. */
export function lonLatToMercator(lon: number, lat: number): [number, number] {
  const R = 6378137;
  const x = (lon * Math.PI * R) / 180;
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360));
  return [x, y];
}

/** Convert a WGS84 bbox into the metric CRS (for spatial selection tools). */
export function bboxFromGeoJson(crs: ProjectedCrs, bbox: [number, number, number, number]) {
  const a = toUtmLocal(bbox[0], bbox[1], crs);
  const b = toUtmLocal(bbox[2], bbox[3], crs);
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

export function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

/** Well-Known Text export (LINESTRING / POINT) in the canonical metric CRS. */
export function toWkt(crs: ProjectedCrs, geometries: Array<{ type: "point" | "line"; coords: Array<[number, number]>; props: Record<string, unknown> }>): string {
  const lines = [`# SRID=${crs.srid}; CRS="${crs.name}"; units=metre`];
  for (const g of geometries) {
    if (g.type === "point") {
      lines.push(`POINT (${g.coords[0][0].toFixed(3)} ${g.coords[0][1].toFixed(3)})`);
    } else {
      lines.push(`LINESTRING (${g.coords.map(([x, y]) => `${x.toFixed(3)} ${y.toFixed(3)}`).join(", ")})`);
    }
  }
  return lines.join("\n");
}
