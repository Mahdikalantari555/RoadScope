import { describe, expect, it } from 'vitest';
import { wgs84ToMetric, wgs84ToUtm32N } from './colors';

describe('CRS-agnostic coordinate readout', () => {
  it('projects WGS84 into Web Mercator metres (the default canonical CRS)', () => {
    const tehran = wgs84ToMetric(51.389, 35.6892);
    // EPSG:3857 metres for Tehran: ~5.72e6 E, ~4.25e6 N.
    expect(tehran.x_m!).toBeGreaterThan(5_700_000);
    expect(tehran.x_m!).toBeLessThan(5_740_000);
    expect(tehran.y_m!).toBeGreaterThan(4_240_000);
    expect(tehran.y_m!).toBeLessThan(4_280_000);
  });

  it('is not tied to one city: any world coordinate projects', () => {
    const amsterdam = wgs84ToMetric(4.8952, 52.3702);
    const buenosAires = wgs84ToMetric(-58.3816, -34.6037);
    expect(amsterdam.x_m!).toBeCloseTo(544_930, -2);
    expect(buenosAires.y_m!).toBeLessThan(0);
  });

  it('clamps latitudes outside the Web Mercator limit instead of returning Infinity', () => {
    const polar = wgs84ToMetric(10, 89.9);
    expect(Number.isFinite(polar.y_m)).toBe(true);
  });

  it('projects Tehran and Frankfurt to their actual local CRSs', () => {
    const tehran = wgs84ToMetric(51.389, 35.6892, 32639);
    expect(tehran.x_m!).toBeCloseTo(535196.8, 0);
    expect(tehran.y_m!).toBeCloseTo(3949546.8, 0);
    const frankfurt = wgs84ToMetric(8.6885, 50.1155, 25832);
    expect(frankfurt.x_m!).toBeCloseTo(477729.3, 0);
    expect(frankfurt.y_m!).toBeCloseTo(5551519.1, 0);
    expect(wgs84ToUtm32N(8.6885, 50.1155)).toEqual(frankfurt);
  });

  it('does not mislabel Web Mercator values for an unknown CRS', () => {
    expect(wgs84ToMetric(51.389, 35.6892, 27700)).toEqual({ x_m: null, y_m: null });
    expect(wgs84ToMetric(Number.NaN, 35, 32639)).toEqual({ x_m: null, y_m: null });
  });
});
