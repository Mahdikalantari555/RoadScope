// Perceptual Colorblind-Safe Palettes & CRS-agnostic Live Coordinate Readout Math

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
 * WGS84 -> Web Mercator (EPSG:3857) forward projection, the platform's default canonical
 * metric CRS. Any study area may declare another projected CRS; for those, the backend
 * remains the authority on metric coordinates (see `POST /api/v1/crs/project`). This local
 * projection only powers the zero-latency cursor readout.
 */
export function wgs84ToMetric(lonDeg: number, latDeg: number, epsg = 3857): { x_m: number; y_m: number } {
  if (epsg === 3857 || epsg === 900913) {
    const R = 6378137.0;
    const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, latDeg));
    const x = R * (lonDeg * Math.PI) / 180.0;
    const y = R * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360.0));
    return { x_m: Math.round(x * 10) / 10, y_m: Math.round(y * 10) / 10 };
  }
  // Unsupported local projection: fall back to Web Mercator for the readout only.
  return wgs84ToMetric(lonDeg, latDeg, 3857);
}

/** @deprecated kept for backwards compatibility; prefer `wgs84ToMetric(lon, lat, epsg)`. */
export function wgs84ToUtm32N(lonDeg: number, latDeg: number): { x_m: number; y_m: number } {
  return wgs84ToMetric(lonDeg, latDeg, 3857);
}
