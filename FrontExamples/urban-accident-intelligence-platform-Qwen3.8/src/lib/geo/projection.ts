/**
 * Dual-CRS engine: WGS84 geographic <-> UTM metric projected.
 *
 * Canonical storage is metric (metres). Geographic coordinates are produced
 * only at the serialisation boundary. Implementation follows Snyder (1987)
 * "Map Projections — A Working Reference Manual", USGS PP 1395, pp. 60-64.
 */

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_SOUTH = 10000000;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface ProjectedCrs {
  srid: number;
  authority: string;
  name: string;
  zone: number;
  hemisphere: "north" | "south";
  centralMeridianDeg: number;
}

export function utmZoneForLongitude(lonDeg: number): number {
  return Math.floor((lonDeg + 180) / 6) % 60 + 1;
}

export function crsForOrigin(lon: number, lat: number): ProjectedCrs {
  const zone = utmZoneForLongitude(lon);
  const hemisphere = lat < 0 ? "south" : "north";
  return {
    zone,
    hemisphere,
    centralMeridianDeg: zone * 6 - 183,
    authority: "EPSG",
    srid: (hemisphere === "north" ? 32600 : 32700) + zone,
    name: `WGS 84 / UTM zone ${zone}${hemisphere === "north" ? "N" : "S"}`,
  };
}

function meridianArc(latRad: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    WGS84_A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * latRad -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * latRad) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * latRad) -
      ((35 * e6) / 3072) * Math.sin(6 * latRad))
  );
}

/** WGS84 (lon, lat degrees) -> UTM (easting, northing metres). */
export function toUtm(lon: number, lat: number, crs: ProjectedCrs): { x: number; y: number } {
  const phi = lat * D2R;
  const lam = (lon - crs.centralMeridianDeg) * D2R;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const N = WGS84_A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = EP2 * cosPhi * cosPhi;
  const A = lam * cosPhi;
  const A2 = A * A;
  const M = meridianArc(phi);
  const x =
    K0 *
      N *
      (A + ((1 - T + C) * A * A2) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * A * A2 * A2) / 120) +
    FALSE_EASTING;
  let y =
    K0 *
    (M +
      N *
        tanPhi *
        (A2 / 2 +
          ((5 - T + 18 * C + 14 * C * C) * A2 * A2) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * A2 * A2 * A2) / 720));
  if (crs.hemisphere === "south") y += FALSE_NORTHING_SOUTH;
  return { x, y };
}

/** UTM (easting, northing metres) -> WGS84 (lon, lat degrees). */
export function toWgs84(x: number, y: number, crs: ProjectedCrs): { lon: number; lat: number } {
  const yn = crs.hemisphere === "south" ? y - FALSE_NORTHING_SOUTH : y;
  const xn = x - FALSE_EASTING;
  const M1 = yn / K0;
  const mu = M1 / (WGS84_A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const C1 = EP2 * cosPhi1 * cosPhi1;
  const T1 = tanPhi1 * tanPhi1;
  const N1 = WGS84_A / Math.sqrt(1 - E2 * sinPhi1 * sinPhi1);
  const R1 =
    (WGS84_A * (1 - E2)) / Math.pow(1 - E2 * sinPhi1 * sinPhi1, 1.5);
  const D = xn / (N1 * K0);
  const D2 = D * D;

  const phi =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D2 * D2) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D2 * D2 * D2) / 720);
  const lam =
    (D -
      ((1 + 2 * T1 + C1) * D * D2) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D * D2 * D2) / 120) /
    cosPhi1;

  return { lat: phi * R2D, lon: crs.centralMeridianDeg + lam * R2D };
}

/** Spatial hash cell key for the discrete grid index (R-Tree surrogate). */
export function gridKey(x: number, y: number, cellSizeM = 100): string {
  return `${Math.floor(x / cellSizeM)}:${Math.floor(y / cellSizeM)}`;
}

export function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const R = 6371008.8;
  const dPhi = (lat2 - lat1) * D2R;
  const dLam = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dPhi / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLam / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
