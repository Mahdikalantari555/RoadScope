/**
 * Dual-CRS Engine & Linear Referencing System (LRS) Primitives
 * Canonical Metric CRS: EPSG:32618 (WGS 84 / UTM Zone 18N, units: meters)
 * Serialization / Web Mapping Geographic CRS: EPSG:4326 (WGS 84, units: degrees)
 *
 * Study Area Anchor:
 * Metric origin (X0 = 584000.0 m E, Y0 = 4512000.0 m N) <-> (-74.0050 deg W, 40.7550 deg N)
 */

export const SRID_METRIC = 32618;
export const SRID_GEOGRAPHIC = 4326;

export const STUDY_ORIGIN_X_M = 583000.0;
export const STUDY_ORIGIN_Y_M = 4511000.0;
export const STUDY_MAX_X_M = 586200.0;
export const STUDY_MAX_Y_M = 4513800.0;

// Local tangent-plane scale calibrated to UTM Zone 18N at 40.755°N
const REF_LON = -74.0165;
const REF_LAT = 40.7460;
const METERS_PER_DEG_LAT = 111048.5;
const METERS_PER_DEG_LON = 84326.2; // cos(40.755°) * 111319.5

export function metricToGeo(xM: number, yM: number): [number, number] {
  const dx = xM - STUDY_ORIGIN_X_M;
  const dy = yM - STUDY_ORIGIN_Y_M;
  const lon = Number((REF_LON + dx / METERS_PER_DEG_LON).toFixed(6));
  const lat = Number((REF_LAT + dy / METERS_PER_DEG_LAT).toFixed(6));
  return [lon, lat];
}

export function geoToMetric(lon: number, lat: number): [number, number] {
  const xM = Number((STUDY_ORIGIN_X_M + (lon - REF_LON) * METERS_PER_DEG_LON).toFixed(2));
  const yM = Number((STUDY_ORIGIN_Y_M + (lat - REF_LAT) * METERS_PER_DEG_LAT).toFixed(2));
  return [xM, yM];
}

export function isWithinMetricBounds(xM: number, yM: number, marginM = 300): boolean {
  return (
    xM >= STUDY_ORIGIN_X_M - marginM &&
    xM <= STUDY_MAX_X_M + marginM &&
    yM >= STUDY_ORIGIN_Y_M - marginM &&
    yM <= STUDY_MAX_Y_M + marginM
  );
}

export function euclideanDistanceM(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function computePolylineLengthM(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += euclideanDistanceM(
      coords[i - 1][0],
      coords[i - 1][1],
      coords[i][0],
      coords[i][1]
    );
  }
  return Number(total.toFixed(2));
}

export function computeSinuosity(coords: [number, number][]): number {
  if (coords.length < 2) return 1.0;
  const pathLen = computePolylineLengthM(coords);
  const straightLen = euclideanDistanceM(
    coords[0][0],
    coords[0][1],
    coords[coords.length - 1][0],
    coords[coords.length - 1][1]
  );
  if (straightLen <= 1e-6) return 1.0;
  return Number(Math.max(1.0, pathLen / straightLen).toFixed(3));
}

/**
 * Linear Referencing System (LRS):
 * Interpolates a point [xM, yM] at linear distance offset m along a metric polyline.
 */
export function interpolateAlongPolylineM(
  coords: [number, number][],
  targetM: number
): [number, number] {
  if (coords.length === 0) return [STUDY_ORIGIN_X_M, STUDY_ORIGIN_Y_M];
  if (coords.length === 1 || targetM <= 0) return [coords[0][0], coords[0][1]];

  let accumulated = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    const segLen = euclideanDistanceM(x1, y1, x2, y2);
    if (accumulated + segLen >= targetM) {
      const ratio = segLen > 0 ? (targetM - accumulated) / segLen : 0;
      return [
        Number((x1 + ratio * (x2 - x1)).toFixed(2)),
        Number((y1 + ratio * (y2 - y1)).toFixed(2)),
      ];
    }
    accumulated += segLen;
  }
  const last = coords[coords.length - 1];
  return [last[0], last[1]];
}

/**
 * Extracts a sub-polyline slice between linear offsets [mStart, mEnd] for lixel generation.
 */
export function slicePolylineByM(
  coords: [number, number][],
  mStart: number,
  mEnd: number
): [number, number][] {
  const startPt = interpolateAlongPolylineM(coords, mStart);
  const endPt = interpolateAlongPolylineM(coords, mEnd);
  const result: [number, number][] = [startPt];

  let accumulated = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    const segLen = euclideanDistanceM(x1, y1, x2, y2);
    const vertexM = accumulated + segLen;
    if (vertexM > mStart + 0.05 && vertexM < mEnd - 0.05) {
      result.push([Number(x2.toFixed(2)), Number(y2.toFixed(2))]);
    }
    accumulated = vertexM;
  }

  result.push(endPt);
  return result;
}

/**
 * Projects an arbitrary point (px, py) orthogonally onto a metric polyline.
 * Returns the snapped coordinate, orthogonal distance d_perp, and LRS offset m.
 */
export function projectPointOntoPolylineM(
  px: number,
  py: number,
  coords: [number, number][]
): {
  snappedXM: number;
  snappedYM: number;
  orthogonalDistM: number;
  linearOffsetM: number;
} {
  let bestDist = Infinity;
  let bestX = coords[0][0];
  let bestY = coords[0][1];
  let bestM = 0;
  let accumulatedM = 0;

  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(segLenSq);

    let t = 0;
    if (segLenSq > 1e-9) {
      t = ((px - x1) * dx + (py - y1) * dy) / segLenSq;
      t = Math.max(0, Math.min(1, t));
    }

    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    const dist = euclideanDistanceM(px, py, projX, projY);

    if (dist < bestDist) {
      bestDist = dist;
      bestX = Number(projX.toFixed(2));
      bestY = Number(projY.toFixed(2));
      bestM = Number((accumulatedM + t * segLen).toFixed(2));
    }
    accumulatedM += segLen;
  }

  return {
    snappedXM: bestX,
    snappedYM: bestY,
    orthogonalDistM: Number(bestDist.toFixed(2)),
    linearOffsetM: bestM,
  };
}
