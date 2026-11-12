/**
 * Synthetic study area "Vantia" — a fictional metropolitan area.
 *
 * The geometry is generated from a fixed seed and does NOT describe any real
 * municipality; the coordinate frame is arbitrary. The generator produces:
 *   - 12 district polygons with shared, smoothly warped boundaries
 *   - a river corridor, a lake and four parks
 *   - a connected road network (ring road, arterials, secondaries, local streets)
 *   - intersections with signalisation and road-class attributes
 */
import { makeProjection, project, pointInPolygon, unproject, type LngLat } from "../geo";

export const CITY = {
  name: "Vantia",
  code: "VNT",
  center: { lat: 52.301, lng: 4.951 },
  halfWidthM: 6800,
  halfHeightM: 5400,
  crs: "local equidistant / EPSG:4326 storage",
} as const;

const proj = makeProjection(CITY.center.lat, CITY.center.lng);

export function warp(u: number, v: number): { x: number; y: number } {
  return {
    x: u * CITY.halfWidthM + 430 * Math.sin(v * 2.6 + 0.4) + 175 * Math.sin(v * 5.3 + 1.7),
    y: v * CITY.halfHeightM + 330 * Math.sin(u * 2.2 + 1.1) + 140 * Math.cos(u * 4.7 + 0.6),
  };
}

export function toLngLat(u: number, v: number): { lat: number; lng: number } {
  const { x, y } = warp(u, v);
  return unproject({ x, y }, proj);
}

export function fromXY(x: number, y: number): { lat: number; lng: number } {
  return unproject({ x, y }, proj);
}

export type RoadClass = "ring" | "arterial" | "secondary" | "local";

export type GeneratedSegment = {
  id: string;
  name: string;
  roadClass: RoadClass;
  lanes: number;
  speedLimitKmh: number;
  surface: string;
  isLit: boolean;
  district: string;
  lengthM: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
  aadt: number;
  heavyVehiclePct: number;
  geometry: { type: "LineString"; coordinates: LngLat[] };
};

export type GeneratedIntersection = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  roadNames: string[];
  isSignalised: boolean;
  district: string;
};

export type GeneratedFeature = {
  kind: "district" | "water" | "park" | "airport";
  name: string;
  geometry: { type: "Polygon" | "LineString"; coordinates: number[][] | number[][][] };
  properties: Record<string, unknown>;
};

export type GeneratedCity = {
  districts: { name: string; code: string; centroid: { lat: number; lng: number } }[];
  features: GeneratedFeature[];
  segments: GeneratedSegment[];
  intersections: GeneratedIntersection[];
  center: { lat: number; lng: number };
  extent: { minLat: number; maxLat: number; minLng: number; maxLng: number };
};

const U_LEVELS = [-1, -0.86, -0.7, -0.52, -0.32, -0.13, 0.06, 0.25, 0.45, 0.63, 0.81, 1];
const V_LEVELS = [-1, -0.83, -0.64, -0.44, -0.22, 0, 0.23, 0.46, 0.68, 0.87, 1];

const H_NAMES = [
  "Alder Way",
  "Kestrel Avenue",
  "Foundry Street",
  "Halden Road",
  "Meridian Boulevard",
  "Sable Lane",
  "Orchard Row",
  "Northgate Approach",
  "Tanner Street",
  "Verge Crescent",
  "Quarry Road",
];
const V_NAMES = [
  "Weaver Street",
  "Ironline Road",
  "Cobalt Avenue",
  "Station Parade",
  "Linden Street",
  "Atlas Way",
  "Harbour Road",
  "Copper Row",
  "Elmfield Street",
  "Aurora Avenue",
  "Pinegrove Lane",
  "Kiln Street",
];
const DISTRICT_NAMES = [
  "Old Wharf",
  "Foundry",
  "Marches",
  "Bellvue",
  "Kestrel Park",
  "Southbank",
  "Linden Heights",
  "Northgate",
  "Harbour East",
  "Copperfield",
  "Meridian",
  "Quarry Hill",
];

const U_BREAKS = [-1, -0.52, 0.06, 0.55, 1];
const V_BREAKS = [-1, -0.36, 0.3, 1];

function districtPolygon(ub: number[], vb: number[], row: number, col: number): LngLat[] {
  const ring: LngLat[] = [];
  const densify = 6;
  const corners: [number, number][] = [
    [ub[col], vb[row]],
    [ub[col + 1], vb[row]],
    [ub[col + 1], vb[row + 1]],
    [ub[col], vb[row + 1]],
  ];
  for (let c = 0; c < 4; c += 1) {
    const [u0, v0] = corners[c];
    const [u1, v1] = corners[(c + 1) % 4];
    for (let s = 0; s < densify; s += 1) {
      const t = s / densify;
      const p = toLngLat(u0 + (u1 - u0) * t, v0 + (v1 - v0) * t);
      ring.push([p.lng, p.lat]);
    }
  }
  ring.push(ring[0]);
  return ring;
}

function findDistrict(districts: { name: string; ring: LngLat[] }[], lat: number, lng: number): string {
  for (const d of districts) if (pointInPolygon([lng, lat], d.ring)) return d.name;
  let best = districts[0]?.name ?? "Unassigned";
  let bestD = Infinity;
  for (const d of districts) {
    const c = d.ring[0];
    const dist = Math.hypot((c[1] - lat) * 111_132, (c[0] - lng) * 68_000);
    if (dist < bestD) {
      bestD = dist;
      best = d.name;
    }
  }
  return best;
}

function classForAxis(levelIndex: number, count: number, axis: "u" | "v"): RoadClass {
  const mid = (count - 1) / 2;
  const fromCentre = Math.abs(levelIndex - mid);
  if (fromCentre <= 1) return "arterial";
  if (fromCentre <= 2.4) return "secondary";
  return axis === "u" ? "secondary" : "local";
}

function roadAttributes(
  cls: RoadClass,
  seedNumber: number,
  litOverride?: boolean,
): { lanes: number; speedLimitKmh: number; surface: string; isLit: boolean; aadt: number; heavyVehiclePct: number } {
  const jitter = (seedNumber * 37) % 7;
  switch (cls) {
    case "ring":
      return {
        lanes: 6,
        speedLimitKmh: 80,
        surface: "asphalt",
        isLit: true,
        aadt: 48_000 + jitter * 1900,
        heavyVehiclePct: 12.5 + (jitter % 3),
      };
    case "arterial":
      return {
        lanes: jitter % 2 === 0 ? 4 : 5,
        speedLimitKmh: jitter % 3 === 0 ? 60 : 50,
        surface: "asphalt",
        isLit: litOverride ?? true,
        aadt: 19_000 + jitter * 2600,
        heavyVehiclePct: 8.4 + (jitter % 4),
      };
    case "secondary":
      return {
        lanes: jitter % 3 === 0 ? 3 : 2,
        speedLimitKmh: 40 + (jitter % 2) * 10,
        surface: jitter % 5 === 0 ? "surface dressed" : "asphalt",
        isLit: litOverride ?? jitter % 4 !== 0,
        aadt: 7200 + jitter * 950,
        heavyVehiclePct: 5.2 + (jitter % 3),
      };
    default:
      return {
        lanes: 2,
        speedLimitKmh: 30,
        surface: jitter % 6 === 0 ? "paved" : "asphalt",
        isLit: litOverride ?? jitter % 3 !== 0,
        aadt: 1100 + jitter * 240,
        heavyVehiclePct: 2.1 + (jitter % 2),
      };
  }
}

function makeSegment(
  name: string,
  cls: RoadClass,
  coords: { lat: number; lng: number }[],
  districts: { name: string; ring: LngLat[] }[],
  idSeed: number,
): GeneratedSegment {
  const attrs = roadAttributes(cls, idSeed);
  const start = coords[0];
  const end = coords[coords.length - 1];
  let lengthM = 0;
  for (let i = 1; i < coords.length; i += 1) {
    const a = project(coords[i - 1], proj);
    const b = project(coords[i], proj);
    lengthM += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;
  return {
    id: `SEG-${String(idSeed).padStart(4, "0")}`,
    name,
    roadClass: cls,
    ...attrs,
    district: findDistrict(districts, midLat, midLng),
    lengthM: Math.round(lengthM * 10) / 10,
    startLat: start.lat,
    startLng: start.lng,
    endLat: end.lat,
    endLng: end.lng,
    minLat: Math.min(...lats),
    minLng: Math.min(...lngs),
    maxLat: Math.max(...lats),
    maxLng: Math.max(...lngs),
    geometry: { type: "LineString", coordinates: coords.map((c) => [c.lng, c.lat] as LngLat) },
  };
}

export function generateCity(): GeneratedCity {
  const districts: { name: string; ring: LngLat[] }[] = [];
  const features: GeneratedFeature[] = [];
  let nameIndex = 0;
  for (let row = 0; row < V_BREAKS.length - 1; row += 1) {
    for (let col = 0; col < U_BREAKS.length - 1; col += 1) {
      const ring = districtPolygon(U_BREAKS, V_BREAKS, row, col);
      const name = DISTRICT_NAMES[nameIndex % DISTRICT_NAMES.length];
      const code = `D${String(nameIndex + 1).padStart(2, "0")}`;
      nameIndex += 1;
      districts.push({ name, ring });
      features.push({
        kind: "district",
        name,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: { code },
      });
      const centre = unproject(
        {
          x: ring.slice(0, -1).reduce((s, p) => s + project({ lat: p[1], lng: p[0] }, proj).x, 0) /
            (ring.length - 1),
          y: ring.slice(0, -1).reduce((s, p) => s + project({ lat: p[1], lng: p[0] }, proj).y, 0) /
            (ring.length - 1),
        },
        proj,
      );
      features[features.length - 1].properties = { code, centroid: centre, areaKm2: 0 };
    }
  }

  // River corridor across the study area (west → east).
  const riverCoords: LngLat[] = [];
  for (let i = 0; i <= 60; i += 1) {
    const u = -1.12 + (2.24 * i) / 60;
    const v = -0.12 + 0.34 * Math.sin(u * 2.1 + 0.6) + 0.1 * Math.cos(u * 4.2);
    const p = toLngLat(u, v);
    riverCoords.push([p.lng, p.lat]);
  }
  features.push({
    kind: "water",
    name: "River Vant",
    geometry: { type: "LineString", coordinates: riverCoords },
    properties: { waterType: "river", widthM: 85 },
  });

  const lakeCentre = toLngLat(-0.52, 0.38);
  const lakeRing: LngLat[] = [];
  const radiusM = 780;
  for (let i = 0; i < 40; i += 1) {
    const theta = (i / 40) * Math.PI * 2;
    const p = unproject(
      {
        x: project(lakeCentre, proj).x + Math.cos(theta) * radiusM * (1 + 0.18 * Math.sin(theta * 3)),
        y: project(lakeCentre, proj).y + Math.sin(theta) * radiusM * 0.72,
      },
      proj,
    );
    lakeRing.push([p.lng, p.lat]);
  }
  lakeRing.push(lakeRing[0]);
  features.push({
    kind: "water",
    name: "Lake Bell",
    geometry: { type: "Polygon", coordinates: [lakeRing] },
    properties: { waterType: "lake" },
  });

  const parks: { u: number; v: number; w: number; h: number; name: string }[] = [
    { u: -0.62, v: -0.62, w: 0.16, h: 0.14, name: "Kestrel Park" },
    { u: 0.34, v: -0.3, w: 0.12, h: 0.1, name: "Foundry Green" },
    { u: 0.62, v: 0.52, w: 0.15, h: 0.12, name: "Northgate Common" },
    { u: -0.18, v: 0.62, w: 0.1, h: 0.13, name: "Wharf Gardens" },
  ];
  for (const park of parks) {
    const ring: LngLat[] = [];
    const steps = 16;
    for (let i = 0; i < steps; i += 1) {
      const theta = (i / steps) * Math.PI * 2;
      const p = toLngLat(
        park.u + Math.cos(theta) * park.w * (1 + 0.12 * Math.cos(theta * 4)),
        park.v + Math.sin(theta) * park.h * (1 + 0.1 * Math.sin(theta * 3)),
      );
      ring.push([p.lng, p.lat]);
    }
    ring.push(ring[0]);
    features.push({
      kind: "park",
      name: park.name,
      geometry: { type: "Polygon", coordinates: [ring] },
      properties: { greenSpace: true },
    });
  }

  // ---- road network -------------------------------------------------------
  const segments: GeneratedSegment[] = [];
  const intersections: GeneratedIntersection[] = [];
  const nodeName = (i: number, j: number) => `${V_NAMES[i % V_NAMES.length]} / ${H_NAMES[j % H_NAMES.length]}`;
  let segSeed = 1;

  // intersections on grid nodes
  for (let i = 0; i < U_LEVELS.length; i += 1) {
    for (let j = 0; j < V_LEVELS.length; j += 1) {
      const p = toLngLat(U_LEVELS[i], V_LEVELS[j]);
      const clsU = classForAxis(i, U_LEVELS.length, "u");
      const clsV = classForAxis(j, V_LEVELS.length, "v");
      const isSignals =
        (clsU === "arterial" || clsU === "secondary") && (clsV === "arterial" || clsV === "secondary")
          ? (i + j) % 5 !== 0
          : (i * 7 + j * 3) % 11 === 0;
      intersections.push({
        id: `X-${String(i).padStart(2, "0")}${String(j).padStart(2, "0")}`,
        name: nodeName(i, j),
        lat: p.lat,
        lng: p.lng,
        roadNames: [V_NAMES[i % V_NAMES.length], H_NAMES[j % H_NAMES.length]],
        isSignalised: isSignals,
        district: findDistrict(districts, p.lat, p.lng),
      });
    }
  }

  // horizontal streets (constant v, varying u), densified once per grid gap
  for (let j = 0; j < V_LEVELS.length; j += 1) {
    const cls = classForAxis(j, V_LEVELS.length, "v");
    const name = H_NAMES[j % H_NAMES.length];
    for (let i = 0; i < U_LEVELS.length - 1; i += 1) {
      const uMid = (U_LEVELS[i] + U_LEVELS[i + 1]) / 2;
      const halves: { u: number; v: number }[][] = [
        [
          { u: U_LEVELS[i], v: V_LEVELS[j] },
          { u: uMid, v: V_LEVELS[j] },
        ],
        [
          { u: uMid, v: V_LEVELS[j] },
          { u: U_LEVELS[i + 1], v: V_LEVELS[j] },
        ],
      ];
      for (const half of halves) {
        const coords = half.map((n) => toLngLat(n.u, n.v));
        segments.push(makeSegment(name, cls, coords, districts, (segSeed += 1)));
      }
    }
  }

  // vertical streets
  for (let i = 0; i < U_LEVELS.length; i += 1) {
    const cls = classForAxis(i, U_LEVELS.length, "u");
    const name = V_NAMES[i % V_NAMES.length];
    for (let j = 0; j < V_LEVELS.length - 1; j += 1) {
      const vMid = (V_LEVELS[j] + V_LEVELS[j + 1]) / 2;
      const halves: { u: number; v: number }[][] = [
        [
          { u: U_LEVELS[i], v: V_LEVELS[j] },
          { u: U_LEVELS[i], v: vMid },
        ],
        [
          { u: U_LEVELS[i], v: vMid },
          { u: U_LEVELS[i], v: V_LEVELS[j + 1] },
        ],
      ];
      for (const half of halves) {
        const coords = half.map((n) => toLngLat(n.u, n.v));
        segments.push(makeSegment(name, cls, coords, districts, (segSeed += 1)));
      }
    }
  }

  // ring road (harmonic ellipse) split into 32 chords
  const ringPoints: { lat: number; lng: number }[] = [];
  for (let k = 0; k < 33; k += 1) {
    const theta = (k / 32) * Math.PI * 2;
    const p = toLngLat(
      Math.cos(theta) * 0.9 * (1 + 0.05 * Math.sin(theta * 3)),
      Math.sin(theta) * 0.86 * (1 + 0.04 * Math.cos(theta * 2)),
    );
    ringPoints.push(p);
  }
  for (let k = 0; k < 32; k += 1) {
    const theta = (k / 32) * Math.PI * 2;
    const labels = ["Ring Road South", "Ring Road West", "Ring Road North", "Ring Road East"];
    const label = labels[Math.floor(((theta + Math.PI) / (Math.PI * 2)) * 4) % 4];
    segments.push(makeSegment(label, "ring", [ringPoints[k], ringPoints[k + 1]], districts, (segSeed += 1)));
  }

  // two radial parkways (diagonals)
  const diagonals: { u0: number; v0: number; u1: number; v1: number; name: string }[] = [
    { u0: -1.03, v0: -0.98, u1: 0.98, v1: 0.96, name: "Meridian Parkway" },
    { u0: -0.98, v0: 0.92, u1: 1.0, v1: -0.9, name: "Southbank Expressway" },
  ];
  for (const diag of diagonals) {
    const chunks = 8;
    for (let k = 0; k < chunks; k += 1) {
      const t0 = k / chunks;
      const t1 = (k + 1) / chunks;
      const coords = [
        toLngLat(diag.u0 + (diag.u1 - diag.u0) * t0, diag.v0 + (diag.v1 - diag.v0) * t0),
        toLngLat(diag.u0 + (diag.u1 - diag.u0) * t1, diag.v0 + (diag.v1 - diag.v0) * t1),
      ];
      segments.push(makeSegment(diag.name, "arterial", coords, districts, (segSeed += 1)));
    }
  }

  const districtSummary = districts.map((d, idx) => {
    const centre = unproject(
      {
        x: d.ring.slice(0, -1).reduce((s, p) => s + project({ lat: p[1], lng: p[0] }, proj).x, 0) /
          (d.ring.length - 1),
        y: d.ring.slice(0, -1).reduce((s, p) => s + project({ lat: p[1], lng: p[0] }, proj).y, 0) /
          (d.ring.length - 1),
      },
      proj,
    );
    return { name: d.name, code: `D${String(idx + 1).padStart(2, "0")}`, centroid: centre };
  });

  const lats = segments.flatMap((s) => [s.minLat, s.maxLat]);
  const lngs = segments.flatMap((s) => [s.minLng, s.maxLng]);

  return {
    districts: districtSummary,
    features,
    segments,
    intersections,
    center: CITY.center,
    extent: {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    },
  };
}

export { proj as cityProjection };
