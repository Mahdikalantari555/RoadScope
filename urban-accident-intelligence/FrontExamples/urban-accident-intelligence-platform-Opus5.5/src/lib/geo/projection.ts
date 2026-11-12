/**
 * WGS84 ⇄ UTM (Transverse Mercator) projection, Snyder (1987) "Map Projections — A Working Manual",
 * USGS PP 1395, eqs. 8-9 … 8-25. Sub-millimetre accuracy within the zone; no external dependency.
 * The platform's metric CRS is EPSG:32633 (WGS 84 / UTM zone 33N).
 */
export const METRIC_CRS = { epsg: 32633, name: "WGS 84 / UTM zone 33N", zone: 33, north: true } as const;
export const GEOGRAPHIC_CRS = { epsg: 4326, name: "WGS 84" } as const;

const a = 6378137.0;
const f = 1 / 298.257223563;
const k0 = 0.9996;
const e2 = f * (2 - f);
const e4 = e2 * e2;
const e6 = e4 * e2;
const ep2 = e2 / (1 - e2);
const DEG = Math.PI / 180;

function centralMeridian(zone: number): number {
  return ((zone - 1) * 6 - 180 + 3) * DEG;
}

function meridianArc(phi: number): number {
  return (
    a *
    ((1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * e2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  );
}

/** lon/lat (degrees) → [easting, northing] metres. */
export function toUtm(lon: number, lat: number, zone: number = METRIC_CRS.zone): [number, number] {
  const phi = lat * DEG;
  const lam = lon * DEG;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sin * sin);
  const T = tan * tan;
  const C = ep2 * cos * cos;
  const A = cos * (lam - centralMeridian(zone));
  const M = meridianArc(phi);
  const x =
    k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const y =
    k0 *
    (M +
      N *
        tan *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [x, lat < 0 ? y + 10000000 : y];
}

/** [easting, northing] metres → [lon, lat] degrees (northern hemisphere). */
export function fromUtm(x: number, y: number, zone: number = METRIC_CRS.zone): [number, number] {
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(phi1);
  const cos1 = Math.cos(phi1);
  const tan1 = Math.tan(phi1);
  const C1 = ep2 * cos1 * cos1;
  const T1 = tan1 * tan1;
  const N1 = a / Math.sqrt(1 - e2 * sin1 * sin1);
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sin1 * sin1, 1.5);
  const D = (x - 500000) / (N1 * k0);
  const phi =
    phi1 -
    ((N1 * tan1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  const lam =
    centralMeridian(zone) +
    (D - ((1 + 2 * T1 + C1) * D ** 3) / 6 + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
      cos1;
  return [lam / DEG, phi / DEG];
}

/** Round a coordinate to ~1e-7° (≈1 cm) for compact GeoJSON. */
export function roundCoord(v: number): number {
  return Math.round(v * 1e7) / 1e7;
}
