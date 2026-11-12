import { describe, expect, it } from "vitest";
import { convexHull, isWithinStudyCoverage, lonLatToUtm, pointToPolyline, ringArea, SpatialHash, utmToLonLat } from "@/lib/geo";
import { STUDY_AREA } from "@/lib/domain";

describe("projection (EPSG:32633)", () => {
  it("round-trips WGS 84 coordinates through UTM zone 33N", () => {
    const [x, y] = lonLatToUtm(13.405, 52.52);
    const [lon, lat] = utmToLonLat(x, y);
    expect(lon).toBeCloseTo(13.405, 6);
    expect(lat).toBeCloseTo(52.52, 6);
  });

  it("uses the zone's central meridian and equator as the origin of false easting/northing", () => {
    const [x, y] = lonLatToUtm(15, 0);
    expect(x).toBeCloseTo(500000, 0);
    expect(y).toBeCloseTo(0, 0);
  });

  it("accepts the study centre and rejects points far outside the coverage", () => {
    expect(isWithinStudyCoverage(STUDY_AREA.center.lon, STUDY_AREA.center.lat)).toBe(true);
    expect(isWithinStudyCoverage(14.5, STUDY_AREA.center.lat)).toBe(false);
    expect(isWithinStudyCoverage(Number.NaN, 52.5)).toBe(false);
  });
});

describe("planar geometry", () => {
  it("computes the convex hull of a square with an interior point", () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);
    expect(hull).toHaveLength(4);
    expect(ringArea([...hull, hull[0]!])).toBeCloseTo(16, 6);
  });

  it("measures point-to-polyline distance and the closest vertex index", () => {
    const hit = pointToPolyline(5, 3, [
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(hit.distance).toBeCloseTo(3, 9);
    expect(hit.index).toBe(0);
  });

  it("returns only points inside the query radius from the spatial hash", () => {
    const xs = [0, 5, 50, 500];
    const ys = [0, 0, 0, 0];
    const hash = new SpatialHash(25, xs, ys);
    expect(hash.query(0, 0, 10).sort()).toEqual([0, 1]);
    expect(hash.query(0, 0, 60).sort()).toEqual([0, 1, 2]);
  });
});
