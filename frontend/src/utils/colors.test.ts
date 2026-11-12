import { describe, expect, it } from 'vitest';
import { wgs84ToMetric, wgs84ToUtm32N } from './colors';

describe('CRS-agnostic coordinate readout', () => {
  it('projects WGS84 into Web Mercator metres (the default canonical CRS)', () => {
    const tehran = wgs84ToMetric(51.389, 35.6892);
    // EPSG:3857 metres for Tehran: ~5.72e6 E, ~4.25e6 N.
    expect(tehran.x_m).toBeGreaterThan(5_700_000);
    expect(tehran.x_m).toBeLessThan(5_740_000);
    expect(tehran.y_m).toBeGreaterThan(4_240_000);
    expect(tehran.y_m).toBeLessThan(4_280_000);
  });

  it('is not tied to one city: any world coordinate projects', () => {
    const amsterdam = wgs84ToMetric(4.8952, 52.3702);
    const buenosAires = wgs84ToMetric(-58.3816, -34.6037);
    expect(amsterdam.x_m).toBeCloseTo(544_930, -2);
    expect(buenosAires.y_m).toBeLessThan(0);
  });

  it('clamps latitudes outside the Web Mercator limit instead of returning Infinity', () => {
    const polar = wgs84ToMetric(10, 89.9);
    expect(Number.isFinite(polar.y_m)).toBe(true);
  });

  it('keeps the legacy UTM helper working but expressed in the platform CRS', () => {
    expect(wgs84ToUtm32N(51.389, 35.6892)).toEqual(wgs84ToMetric(51.389, 35.6892));
  });
});
