/**
 * Deterministic synthetic data generator for the Meridian District study area.
 *
 * Every random draw goes through a seeded mulberry32 stream, so the same
 * (seed, scenario, count) triple always yields byte-identical rows. This is
 * what makes the analytical outputs reproducible and reviewable.
 *
 * NOTHING produced here is real-world accident data.
 */

import { CATEGORIES, SEVERITIES, STUDY_BOUNDS } from "./constants";
import { unproject, haversineM } from "./geo";

export type Scenario =
  | "uniform"
  | "intersection_dominated"
  | "rush_hour_dominated"
  | "mixed";

export interface SyntheticConfig {
  seed: number;
  scenario: Scenario;
  accidentCount: number;
  /** grid dimensions */
  cols: number;
  rows: number;
  /** node spacing in metres */
  spacingX: number;
  spacingY: number;
  coverageDays: number;
  duplicateRate: number;
  impreciseRate: number;
  maxReportDelayH: number;
}

export const DEFAULT_CONFIG: SyntheticConfig = {
  seed: 20240917,
  scenario: "mixed",
  accidentCount: 1800,
  cols: 26,
  rows: 18,
  spacingX: 178,
  spacingY: 196,
  coverageDays: 420,
  duplicateRate: 0.045,
  impreciseRate: 0.11,
  maxReportDelayH: 96,
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const pick = <T,>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)];

const weighted = <T,>(rng: Rng, arr: readonly T[], w: (t: T) => number): T => {
  const total = arr.reduce((a, b) => a + w(b), 0);
  let r = rng() * total;
  for (const item of arr) {
    r -= w(item);
    if (r <= 0) return item;
  }
  return arr[arr.length - 1];
};

const STREETS_EW = [
  "Meridian Avenue", "Kestrel Street", "Foundry Road", "Harbour Row", "Ellis Way",
  "Lantern Street", "Quarry Lane", "Northgate Road", "Vessel Street", "Alder Avenue",
  "Signal Road", "Tannery Street", "Cloister Row", "Brazen Lane", "Sable Street",
  "Windlass Road", "Orchard Avenue", "Southbank Road",
];
const STREETS_NS = [
  "Cross Quay", "Beacon Street", "Ironmonger Lane", "Copperfield Road", "Dray Street",
  "Ember Way", "Fenwick Street", "Granary Road", "Halyard Lane", "Ink Street",
  "Juniper Road", "Kiln Street", "Loam Lane", "Muster Road", "Nail Street",
  "Ossier Way", "Pilot Street", "Quill Road", "Ropery Lane", "Salt Street",
  "Trellis Road", "Umber Lane", "Vantage Street", "Weir Road", "Yardarm Lane", "Zephyr Street",
];

const DISTRICTS = [
  { name: "Northgate", colMin: 0, colMax: 8, rowMin: 0, rowMax: 5 },
  { name: "Foundry Quarter", colMin: 9, colMax: 17, rowMin: 0, rowMax: 5 },
  { name: "Vessel Heights", colMin: 18, colMax: 25, rowMin: 0, rowMax: 5 },
  { name: "Meridian Core", colMin: 0, colMax: 8, rowMin: 6, rowMax: 11 },
  { name: "Harbour Ward", colMin: 9, colMax: 17, rowMin: 6, rowMax: 11 },
  { name: "Ellis Yards", colMin: 18, colMax: 25, rowMin: 6, rowMax: 11 },
  { name: "Alder Fields", colMin: 0, colMax: 8, rowMin: 12, rowMax: 17 },
  { name: "Southbank", colMin: 9, colMax: 17, rowMin: 12, rowMax: 17 },
  { name: "Weir Estate", colMin: 18, colMax: 25, rowMin: 12, rowMax: 17 },
];

export interface SynthNode {
  id: number;
  col: number;
  row: number;
  lon: number;
  lat: number;
  district: string;
  isSignalised: boolean;
  isPriority: boolean;
}

export interface SynthSegment {
  segmentCode: string;
  streetName: string;
  roadClass: "arterial" | "collector" | "local";
  district: string;
  fromNodeId: number;
  toNodeId: number;
  lengthM: number;
  bearingDeg: number;
  speedLimitKph: number;
  lanes: number;
  lighting: string;
  surface: string;
  hasJunctionControl: boolean;
  hasCycleLane: boolean;
  centroidLon: number;
  centroidLat: number;
  coordinates: [number, number][];
  /** internal generation weights */
  _attraction: number;
}

export interface SynthAccident {
  publicId: string;
  categoryCode: string;
  severityCode: string;
  severityWeight: number;
  segmentIndex: number | null;
  lon: number;
  lat: number;
  reportedLon: number;
  reportedLat: number;
  positionalAccuracyM: number;
  geocodePrecision: "pin" | "address" | "street" | "approximate";
  occurredAt: Date;
  reportedAt: Date;
  reportDelayH: number;
  vehicles: number;
  casualties: number;
  description: string;
  emergencyServices: boolean;
  status: "pending" | "verified" | "rejected" | "duplicate";
  duplicateOfIndex: number | null;
  rejectReason: string | null;
  reporterHandle: string;
  lighting: string;
  weather: string;
  roadSurface: string;
  district: string;
  _imprecise: boolean;
}

const districtFor = (col: number, row: number): string =>
  DISTRICTS.find((d) => col >= d.colMin && col <= d.colMax && row >= d.rowMin && row <= d.rowMax)?.name ??
  "Meridian Core";

export function generateNetwork(cfg: SyntheticConfig) {
  const rng = mulberry32(cfg.seed ^ 0x9e3779b9);
  const nodes: SynthNode[] = [];
  const originLon = STUDY_BOUNDS.minLon + 0.006;
  const originLat = STUDY_BOUNDS.minLat + 0.004;

  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols; col++) {
      const [lon, lat] = unproject(col * cfg.spacingX, row * cfg.spacingY, {
        lon: originLon,
        lat: originLat,
      });
      const isArterialRow = row % 6 === 0;
      const isArterialCol = col % 6 === 0;
      nodes.push({
        id: row * cfg.cols + col,
        col,
        row,
        lon,
        lat,
        district: districtFor(col, row),
        isSignalised: (isArterialRow || isArterialCol) && rng() < 0.75,
        isPriority: rng() < 0.22,
      });
    }
  }

  const segments: SynthSegment[] = [];
  const classFor = (idx: number): SynthSegment["roadClass"] =>
    idx % 6 === 0 ? "arterial" : idx % 3 === 0 ? "collector" : "local";

  const pushSegment = (
    a: SynthNode,
    b: SynthNode,
    streetName: string,
    roadClass: SynthSegment["roadClass"],
  ) => {
    const lengthM = haversineM(a.lon, a.lat, b.lon, b.lat);
    const bearing =
      (Math.atan2(b.lon - a.lon, b.lat - a.lat) * 180) / Math.PI;
    const speed =
      roadClass === "arterial" ? 60 : roadClass === "collector" ? 45 : 30;
    const lanes = roadClass === "arterial" ? 4 : roadClass === "collector" ? 2 : 1;
    const attraction =
      (roadClass === "arterial" ? 3.2 : roadClass === "collector" ? 1.5 : 0.6) *
      (a.isSignalised || b.isSignalised ? 1.6 : 1) *
      (rng() * 0.6 + 0.7);
    segments.push({
      segmentCode: `RD-${String(segments.length + 1).padStart(4, "0")}`,
      streetName,
      roadClass,
      district: a.district,
      fromNodeId: a.id,
      toNodeId: b.id,
      lengthM,
      bearingDeg: (bearing + 360) % 360,
      speedLimitKph: speed,
      lanes,
      lighting: roadClass === "local" ? (rng() < 0.4 ? "partial" : "full") : "full",
      surface: rng() < 0.86 ? "asphalt" : rng() < 0.6 ? "concrete" : "paved",
      hasJunctionControl: a.isSignalised || b.isSignalised,
      hasCycleLane: roadClass !== "local" && rng() < 0.42,
      centroidLon: (a.lon + b.lon) / 2,
      centroidLat: (a.lat + b.lat) / 2,
      coordinates: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ],
      _attraction: attraction,
    });
  };

  for (let row = 0; row < cfg.rows; row++) {
    for (let col = 0; col < cfg.cols - 1; col++) {
      const cls = classFor(row);
      pushSegment(
        nodes[row * cfg.cols + col],
        nodes[row * cfg.cols + col + 1],
        STREETS_EW[row % STREETS_EW.length],
        cls,
      );
    }
  }
  for (let col = 0; col < cfg.cols; col++) {
    for (let row = 0; row < cfg.rows - 1; row++) {
      const cls = classFor(col);
      pushSegment(
        nodes[row * cfg.cols + col],
        nodes[(row + 1) * cfg.cols + col],
        STREETS_NS[col % STREETS_NS.length],
        cls,
      );
    }
  }

  return { nodes, segments };
}

function hourWeight(scenario: Scenario, hour: number): number {
  const morning = Math.exp(-((hour - 8) ** 2) / 4.5);
  const evening = Math.exp(-((hour - 17.5) ** 2) / 5.5);
  const night = Math.exp(-((hour - 23) ** 2) / 6) + Math.exp(-((hour - 2) ** 2) / 5);
  switch (scenario) {
    case "rush_hour_dominated":
      return 0.15 + 1.9 * morning + 2.3 * evening + 0.1 * night;
    case "uniform":
      return 1;
    default:
      return 0.35 + 1.15 * morning + 1.35 * evening + 0.55 * night;
  }
}

export function generateAccidents(
  cfg: SyntheticConfig,
  nodes: SynthNode[],
  segments: SynthSegment[],
): SynthAccident[] {
  const rng = mulberry32(cfg.seed);
  const out: SynthAccident[] = [];
  const start = new Date("2024-01-06T00:00:00.000Z");
  const end = new Date(start.getTime() + cfg.coverageDays * 86400000);
  const spanMs = end.getTime() - start.getTime();

  const handles = [
    "citizen-reporter", "commuter-42", "nightwatch", "cycling-observer",
    "local-resident", "transit-user", "anon-reporter", "freight-driver",
  ];

  const totalAttraction = segments.reduce((a, s) => a + s._attraction, 0);
  const junctions = nodes.filter((n) => n.isSignalised || n.isPriority);

  for (let n = 0; n < cfg.accidentCount; n++) {
    // --- location -----------------------------------------------------
    let lon: number, lat: number, segmentIndex: number | null = null;
    const r = rng();
    const clusterBias = cfg.scenario === "intersection_dominated" ? 0.72 : 0.38;

    if (r < clusterBias) {
      // cluster around a chosen junction
      const j = junctions[Math.floor(rng() * junctions.length)];
      const spread = cfg.scenario === "intersection_dominated" ? 42 : 68;
      const dLon = (rng() - 0.5) * 2 * spread;
      const dLat = (rng() - 0.5) * 2 * spread;
      const [lo, la] = unproject(dLon, dLat, { lon: j.lon, lat: j.lat });
      lon = lo;
      lat = la;
      segmentIndex = nearestSegmentIndex(segments, lon, lat);
    } else {
      // sample along the road network weighted by attraction
      let pickR = rng() * totalAttraction;
      let idx = segments.length - 1;
      for (let s = 0; s < segments.length; s++) {
        pickR -= segments[s]._attraction;
        if (pickR <= 0) {
          idx = s;
          break;
        }
      }
      const seg = segments[idx];
      const t = rng();
      const jitter = (rng() - 0.5) * 26;
      lon = seg.coordinates[0][0] + (seg.coordinates[1][0] - seg.coordinates[0][0]) * t;
      lat = seg.coordinates[0][1] + (seg.coordinates[1][1] - seg.coordinates[0][1]) * t;
      const [lo, la] = unproject(jitter, jitter * 0.6, { lon, lat });
      lon = lo;
      lat = la;
      segmentIndex = idx;
    }

    // --- time --------------------------------------------------------
    let occurredAt: Date;
    for (;;) {
      const t = start.getTime() + rng() * spanMs;
      const d = new Date(t);
      const dow = d.getUTCDay();
      const weekendFactor = dow === 0 || dow === 6 ? 0.62 : 1;
      const hour = d.getUTCHours();
      const hw = hourWeight(cfg.scenario, hour);
      if (rng() < (hw * weekendFactor) / 3.2) {
        occurredAt = d;
        break;
      }
    }

    // --- severity ----------------------------------------------------
    const seg = segmentIndex != null ? segments[segmentIndex] : null;
    const speedFactor = seg ? (seg.speedLimitKph - 30) / 30 : 0.5;
    const severity = weighted(rng, SEVERITIES, (s) => {
      switch (s.code) {
        case "fatal":
          return 0.018 + speedFactor * 0.035;
        case "serious":
          return 0.14 + speedFactor * 0.11;
        case "slight":
          return 0.44 - speedFactor * 0.03;
        default:
          return 0.42 - speedFactor * 0.06;
      }
    });

    const category = weighted(rng, CATEGORIES, (c) => {
      const junctionish = c.code === "junction_conflict" || c.code === "pedestrian";
      const clusterBoost = clusterBias > 0.5 && junctionish ? 1.8 : 1;
      const speedBoost =
        c.code === "lane_departure" || c.code === "overturning" ? 1 + speedFactor : 1;
      return clusterBoost * speedBoost;
    });

    const hour = occurredAt.getUTCHours();
    const isNight = hour < 6 || hour > 20;
    const lighting = isNight
      ? seg?.lighting === "partial" || seg?.lighting === "unlit"
        ? "dark_unlit"
        : "dark_lit"
      : hour < 8 || hour > 17
        ? "dusk"
        : "daylight";

    const weatherRoll = rng();
    const weather =
      weatherRoll < 0.52
        ? "clear"
        : weatherRoll < 0.72
          ? "overcast"
          : weatherRoll < 0.88
            ? "rain"
            : weatherRoll < 0.94
              ? "heavy_rain"
              : weatherRoll < 0.97
                ? "fog"
                : weatherRoll < 0.99
                  ? "sleet"
                  : "snow";
    const roadSurface =
      weather === "rain" || weather === "heavy_rain"
        ? "wet"
        : weather === "snow"
          ? "snow_covered"
          : weather === "sleet"
            ? "icy"
            : rng() < 0.06
              ? "wet"
              : "dry";

    const imprecise = rng() < cfg.impreciseRate;
    const positionalAccuracyM = imprecise
      ? 22 + rng() * 96
      : rng() < 0.4
        ? 2 + rng() * 6
        : 6 + rng() * 12;
    const geocodePrecision: SynthAccident["geocodePrecision"] = imprecise
      ? rng() < 0.5
        ? "street"
        : "approximate"
      : rng() < 0.55
        ? "pin"
        : "address";

    const reportDelayH = Math.min(
      cfg.maxReportDelayH,
      Math.exp(rng() * 4.2 - 1.2),
    );
    const reportedAt = new Date(occurredAt.getTime() + reportDelayH * 3600000);

    const severityRank = severity.rank;
    const vehicles =
      category.code === "single_vehicle" || category.code === "overturning"
        ? 1
        : category.code === "pedestrian" || category.code === "cyclist"
          ? 1 + Math.floor(rng() * 2)
          : 1 + Math.floor(rng() * 3.2);
    const casualties =
      severityRank === 4
        ? 0
        : Math.max(1, Math.round(severityRank === 1 ? 1 + rng() * 2 : rng() * 2));

    const status: SynthAccident["status"] = weighted(
      rng,
      ["verified", "pending", "rejected", "duplicate"] as const,
      (s) => (s === "verified" ? 0.62 : s === "pending" ? 0.22 : s === "rejected" ? 0.1 : 0.06),
    );

    out.push({
      publicId: `MRD-${occurredAt.getUTCFullYear()}-${String(n + 1).padStart(5, "0")}`,
      categoryCode: category.code,
      severityCode: severity.code,
      severityWeight: severity.weight,
      segmentIndex,
      lon,
      lat,
      reportedLon: lon + (rng() - 0.5) * 0.00035,
      reportedLat: lat + (rng() - 0.5) * 0.00028,
      positionalAccuracyM,
      geocodePrecision,
      occurredAt,
      reportedAt,
      reportDelayH,
      vehicles,
      casualties,
      description: buildDescription(rng, category.code, severity.code),
      emergencyServices: severityRank <= 2 ? rng() < 0.92 : rng() < 0.31,
      status: status === "duplicate" ? "pending" : status,
      duplicateOfIndex: null,
      rejectReason:
        status === "rejected"
          ? pick(rng, [
              "Location inconsistent with described junction.",
              "Timestamp outside dataset coverage window.",
              "Insufficient detail to establish that an event occurred.",
              "Reported event already covered by an official record.",
            ])
          : null,
      reporterHandle: pick(rng, handles),
      lighting,
      weather,
      roadSurface,
      district: districtFor(
        Math.round((lon - (STUDY_BOUNDS.minLon + 0.006)) / 0.0025),
        Math.round((lat - (STUDY_BOUNDS.minLat + 0.004)) / 0.0022),
      ),
      _imprecise: imprecise,
    });
  }

  // --- deliberate duplicates for the data-quality workflow -------------
  const dupCount = Math.floor(cfg.accidentCount * cfg.duplicateRate);
  for (let d = 0; d < dupCount; d++) {
    const srcIdx = Math.floor(rng() * out.length);
    const src = out[srcIdx];
    const [dlon, dlat] = unproject((rng() - 0.5) * 70, (rng() - 0.5) * 70, {
      lon: src.lon,
      lat: src.lat,
    });
    const delayMin = 8 + rng() * 220;
    out.push({
      ...src,
      publicId: `MRD-${src.occurredAt.getUTCFullYear()}-D${String(d + 1).padStart(4, "0")}`,
      lon: dlon,
      lat: dlat,
      reportedLon: dlon + (rng() - 0.5) * 0.0004,
      reportedLat: dlat + (rng() - 0.5) * 0.0004,
      positionalAccuracyM: 18 + rng() * 60,
      geocodePrecision: rng() < 0.5 ? "street" : "approximate",
      reportedAt: new Date(src.occurredAt.getTime() + delayMin * 60000),
      reportDelayH: delayMin / 60,
      status: "duplicate",
      duplicateOfIndex: srcIdx,
      description: buildDescription(rng, src.categoryCode, src.severityCode),
      reporterHandle: pick(rng, handles),
    });
  }

  return out;
}

function nearestSegmentIndex(
  segments: SynthSegment[],
  lon: number,
  lat: number,
): number | null {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const d = haversineM(lon, lat, s.centroidLon, s.centroidLat);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return bestD < 110 ? best : null;
}

function buildDescription(rng: Rng, category: string, severity: string): string {
  const openings: Record<string, string[]> = {
    junction_conflict: [
      "Two vehicles entered the junction on conflicting signal phases.",
      "Right-of-way conflict at the crossing; one vehicle failed to yield.",
      "Turning vehicle crossed the path of through traffic.",
    ],
    rear_end: [
      "Queueing traffic; following vehicle did not stop in time.",
      "Sudden braking at the approach; rear collision recorded.",
    ],
    sideswipe: [
      "Lane change with insufficient clearance; lateral contact.",
      "Two vehicles travelling in adjacent lanes made contact.",
    ],
    pedestrian: [
      "Pedestrian crossing the carriageway was struck by a vehicle.",
      "Pedestrian stepped from between parked vehicles.",
    ],
    cyclist: [
      "Cyclist and vehicle collided at the junction approach.",
      "Dooring incident; cyclist struck an opened vehicle door.",
    ],
    single_vehicle: [
      "Single vehicle lost control on the wet carriageway.",
      "Vehicle left the carriageway and struck the kerb line.",
    ],
    lane_departure: [
      "Vehicle crossed the centre line into opposing traffic.",
      "Driver drifted out of the lane and onto the verge.",
    ],
    overturning: [
      "Vehicle overturned after striking the central reservation.",
      "Rollover following a loss of control on the bend.",
    ],
    obstacle: [
      "Vehicle struck street furniture at the roadside.",
      "Collision with a barrier following an evasive manoeuvre.",
    ],
  };
  const sevTail =
    severity === "fatal"
      ? " Fatality recorded by attending services."
      : severity === "serious"
        ? " Casualty transported to hospital."
        : severity === "slight"
          ? " Minor injuries treated at the scene."
          : " Property damage only.";
  const list = openings[category] ?? openings.junction_conflict;
  return pick(rng, list) + sevTail;
}

export interface SyntheticTrafficRow {
  segmentIndex: number;
  hourOfDay: number;
  dayType: string;
  volumeVehPerHour: number;
  avgSpeedKph: number;
  aadt: number | null;
  congestionIndex: number;
  coverageRatio: number;
}

export function generateTraffic(
  cfg: SyntheticConfig,
  segments: SynthSegment[],
): SyntheticTrafficRow[] {
  const rng = mulberry32(cfg.seed ^ 0x51ed270b);
  const rows: SyntheticTrafficRow[] = [];
  segments.forEach((seg, i) => {
    const capacity =
      seg.roadClass === "arterial" ? 1650 : seg.roadClass === "collector" ? 820 : 320;
    const aadt = Math.round(capacity * 16 * (0.45 + rng() * 0.5));
    for (const hour of [2, 8, 13, 17, 22]) {
      for (const dayType of ["weekday", "weekend"]) {
        const peak = hourWeight("rush_hour_dominated", hour);
        const base = dayType === "weekend" ? 0.52 : 1;
        const volume = Math.round(capacity * (0.12 + (peak / 3) * 0.85) * base * (0.85 + rng() * 0.3));
        const ratio = Math.min(1, volume / capacity);
        const freeFlow = seg.speedLimitKph;
        const avgSpeed = Math.max(6, freeFlow * (1 - 0.62 * ratio ** 1.7) * (0.94 + rng() * 0.12));
        rows.push({
          segmentIndex: i,
          hourOfDay: hour,
          dayType,
          volumeVehPerHour: volume,
          avgSpeedKph: Math.round(avgSpeed * 10) / 10,
          aadt,
          congestionIndex: Math.round(ratio * 1000) / 1000,
          coverageRatio: rng() < 0.08 ? Math.round(rng() * 60) / 100 : 1,
        });
      }
    }
  });
  return rows;
}

export interface SyntheticEnvRow {
  accidentIndex: number;
  temperatureC: number;
  visibilityM: number;
  precipitationMm: number;
  windKph: number;
  source: string;
}

export function generateEnvironmental(
  cfg: SyntheticConfig,
  accidents: SynthAccident[],
): SyntheticEnvRow[] {
  const rng = mulberry32(cfg.seed ^ 0x2545f491);
  const rows: SyntheticEnvRow[] = [];
  accidents.forEach((a, i) => {
    if (rng() > 0.82) return;
    const wet = a.weather === "rain" || a.weather === "heavy_rain";
    rows.push({
      accidentIndex: i,
      temperatureC: Math.round((2 + rng() * 24 - (a.weather === "snow" ? 8 : 0)) * 10) / 10,
      visibilityM:
        a.weather === "fog"
          ? Math.round(60 + rng() * 240)
          : wet
            ? Math.round(900 + rng() * 3200)
            : Math.round(5000 + rng() * 15000),
      precipitationMm: wet ? Math.round(rng() * (a.weather === "heavy_rain" ? 14 : 5) * 10) / 10 : 0,
      windKph: Math.round((3 + rng() * 34) * 10) / 10,
      source: "synthetic-meteorological-model",
    });
  });
  return rows;
}
