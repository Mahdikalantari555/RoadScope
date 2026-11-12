// Perceptual Colorblind-Safe Palettes & ETRS89 / UTM 32N Live Readout Math

export const VIRIDIS_STOPS: [number, string][] = [
  [0.0, '#440154'],
  [0.2, '#3b528b'],
  [0.4, '#21918c'],
  [0.6, '#5ec962'],
  [0.8, '#b5de2b'],
  [1.0, '#fde725'],
];

export const INFERNO_STOPS: [number, string][] = [
  [0.0, '#160b39'],
  [0.2, '#420a68'],
  [0.4, '#932667'],
  [0.6, '#dd513a'],
  [0.8, '#fca50a'],
  [1.0, '#fcffa4'],
];

// ColorBrewer RdBu diverging (colorblind-safe blue -> neutral -> red)
export const DIVERGING_BIAS_STOPS: [number, string][] = [
  [-1.0, '#2166ac'],
  [-0.4, '#67a9cf'],
  [0.0, '#475569'],
  [0.4, '#ef8a62'],
  [1.0, '#b2182b'],
];

export const BIVARIATE_3X3: Record<string, string> = {
  '1-1': '#e8e8e8',
  '2-1': '#b5c0da',
  '3-1': '#6c83b5',
  '1-2': '#b8d6be',
  '2-2': '#90b2b3',
  '3-2': '#567994',
  '1-3': '#73ae80',
  '2-3': '#5a9178',
  '3-3': '#2a5a5b',
};

/**
 * Exact GRS80 / WGS84 Transverse Mercator forward projection to EPSG:25832 (UTM Zone 32N, central meridian 9°E)
 * for zero-latency 60fps metric coordinate cursor readouts on the cartographic canvas.
 */
export function wgs84ToUtm32N(lonDeg: number, latDeg: number): { x_m: number; y_m: number } {
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const k0 = 0.9996;
  const lon0 = (9.0 * Math.PI) / 180.0;
  const e2 = 2 * f - f * f;
  const ep2 = e2 / (1 - e2);

  const phi = (latDeg * Math.PI) / 180.0;
  const lam = (lonDeg * Math.PI) / 180.0;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - lon0);

  const M =
    a *
    ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi -
      ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi) +
      ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi) -
      ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi));

  const x_m =
    500000.0 +
    k0 *
      N *
      (A +
        ((1 - T + C) * Math.pow(A, 3)) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5)) / 120);

  const y_m =
    k0 *
    (M +
      N *
        tanPhi *
        ((A * A) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4)) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6)) / 720));

  return {
    x_m: Math.round(x_m * 10) / 10,
    y_m: Math.round(y_m * 10) / 10,
  };
}
