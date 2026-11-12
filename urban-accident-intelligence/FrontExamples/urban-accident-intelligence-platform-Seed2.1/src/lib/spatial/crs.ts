// Coordinate Reference System utilities
// We use a local tangent-plane projection centered on a reference point
// (a fictional mid-sized city at longitude -73.95, latitude 40.72).
// Distances in this local metric CRS are in meters, preserving distances
// for spatial analysis, while WGS84 lon/lat are used for the mapping layer.

export const REF_LON = -73.95;
export const REF_LAT = 40.72;
// city bounds: roughly ~5km x 5km
export const CITY_WIDTH_M = 5000;
export const CITY_HEIGHT_M = 5000;

const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;

export function lonLatToMetric(lon: number, lat: number): { x: number; y: number } {
  // Simple equirectangular local projection scaled by cos(lat)
  const x = (lon - REF_LON) * DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(REF_LAT * DEG_TO_RAD);
  const y = (lat - REF_LAT) * DEG_TO_RAD * EARTH_RADIUS_M;
  return { x, y };
}

export function metricToLonLat(x: number, y: number): { lon: number; lat: number } {
  const lon = REF_LON + x / (DEG_TO_RAD * EARTH_RADIUS_M * Math.cos(REF_LAT * DEG_TO_RAD));
  const lat = REF_LAT + y / (DEG_TO_RAD * EARTH_RADIUS_M);
  return { lon, lat };
}

export function metricDistance(
  x1: number, y1: number, x2: number, y2: number
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export type MetricPoint = { x: number; y: number };
export type GeoPoint = { lon: number; lat: number };
export type MetricLineString = MetricPoint[];
export type GeoLineString = GeoPoint[];

export function linestringMetricToGeo(line: MetricLineString): GeoLineString {
  return line.map(p => metricToLonLat(p.x, p.y));
}

export function linestringGeoToMetric(line: GeoLineString): MetricLineString {
  return line.map(p => lonLatToMetric(p.lon, p.lat));
}

export function pointToGeoJsonMetric(p: MetricPoint): GeoJSON.Point {
  return { type: "Point", coordinates: [p.x, p.y] };
}

export function pointToGeoJsonGeo(p: GeoPoint): GeoJSON.Point {
  return { type: "Point", coordinates: [p.lon, p.lat] };
}

export function lineToGeoJsonMetric(line: MetricLineString): GeoJSON.LineString {
  return { type: "LineString", coordinates: line.map(p => [p.x, p.y]) };
}

export function lineToGeoJsonGeo(line: MetricLineString): GeoJSON.LineString {
  const geo = linestringMetricToGeo(line);
  return { type: "LineString", coordinates: geo.map(p => [p.lon, p.lat]) };
}

/**
 * Walk a LineString and return the point at a given offset (m) from the start,
 * along with the cumulative distance table and segment index.
 */
export function locateAlongLine(line: MetricLineString, m: number): {
  point: MetricPoint;
  segmentIndex: number;
  segmentFraction: number;
} {
  if (line.length < 2) throw new Error("Line must have >= 2 points");
  let remaining = m;
  for (let i = 0; i < line.length - 1; i++) {
    const p0 = line[i];
    const p1 = line[i + 1];
    const segLen = metricDistance(p0.x, p0.y, p1.x, p1.y);
    if (remaining <= segLen) {
      const f = segLen === 0 ? 0 : remaining / segLen;
      return {
        point: {
          x: p0.x + (p1.x - p0.x) * f,
          y: p0.y + (p1.y - p0.y) * f,
        },
        segmentIndex: i,
        segmentFraction: f,
      };
    }
    remaining -= segLen;
  }
  // clamp to end
  const last = line[line.length - 1];
  return { point: last, segmentIndex: line.length - 2, segmentFraction: 1 };
}

export function lineLength(line: MetricLineString): number {
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    total += metricDistance(line[i].x, line[i].y, line[i + 1].x, line[i + 1].y);
  }
  return total;
}

/**
 * Compute closest point on line to a query point, and its distance.
 * Returns projected point, distance, and m-offset from start.
 */
export function closestPointOnLine(
  line: MetricLineString,
  query: MetricPoint
): { point: MetricPoint; distance: number; offsetM: number; segmentIndex: number } {
  let bestDist = Infinity;
  let bestPoint: MetricPoint = line[0];
  let bestOffset = 0;
  let bestSegIdx = 0;
  let cumDist = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLen2 = dx * dx + dy * dy;
    let t: number;
    if (segLen2 === 0) {
      t = 0;
    } else {
      t = ((query.x - a.x) * dx + (query.y - a.y) * dy) / segLen2;
      t = Math.max(0, Math.min(1, t));
    }
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = metricDistance(px, py, query.x, query.y);
    const segLen = Math.sqrt(segLen2);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = { x: px, y: py };
      bestOffset = cumDist + t * segLen;
      bestSegIdx = i;
    }
    cumDist += segLen;
  }
  return { point: bestPoint, distance: bestDist, offsetM: bestOffset, segmentIndex: bestSegIdx };
}
