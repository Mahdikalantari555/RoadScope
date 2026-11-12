/**
 * Reproducible synthetic data generator for the Synthetic City study area.
 *
 * Generates: a jittered urban road grid with junctions, per-segment traffic (AADT), hourly
 * weather from three stations, and accident records under four scenarios. Every random draw
 * comes from a seeded PRNG, so identical (seed, scenario, count) always yields identical output.
 *
 * All generated records are labelled synthetic in the database (dataset_sources.is_synthetic).
 */
import {
  CATEGORY_CODES,
  ROAD_CLASS_META,
  STUDY_AREA,
  type CategoryCode,
  type Position,
  type RoadClass,
  type ScenarioId,
} from "./domain";
import { STUDY_CENTER_UTM, utmToLonLat } from "./geo";
import { cumulative, exponential, logNormal, mulberry32, normal, randomCode, sampleCumulative, uniform, weightedIndex } from "./random";
import { zonedToUtc } from "./time";

export const GENERATOR_VERSION = "synthetic-city-generator/1.0";

export interface ScenarioConfig {
  /** Share of incidents placed in the immediate approach to a junction. */
  intersectionShare: number;
  /** Share of incidents placed around embedded hotspot junctions. */
  hotspotShare: number;
  /** Share of incidents whose hour is drawn from the rush-hour profile. */
  rushShare: number;
  hotspotCount: number;
  hotspotSigmaM: number;
  /** Median reporting delay for official (synthetic) records, in minutes. */
  reportDelayMedianMin: number;
  /** Fraction of additional records that duplicate an existing incident. */
  duplicateRate: number;
  /** Fraction of records with coordinates displaced 150–400 m (inaccurate reports). */
  inaccurateRate: number;
}

export const SCENARIO_CONFIG: Record<ScenarioId, ScenarioConfig> = {
  uniform: {
    intersectionShare: 0,
    hotspotShare: 0,
    rushShare: 0,
    hotspotCount: 0,
    hotspotSigmaM: 0,
    reportDelayMedianMin: 30,
    duplicateRate: 0.02,
    inaccurateRate: 0.02,
  },
  intersection: {
    intersectionShare: 0.6,
    hotspotShare: 0,
    rushShare: 0.15,
    hotspotCount: 0,
    hotspotSigmaM: 0,
    reportDelayMedianMin: 25,
    duplicateRate: 0.03,
    inaccurateRate: 0.03,
  },
  rush_hour: {
    intersectionShare: 0.2,
    hotspotShare: 0.05,
    rushShare: 0.7,
    hotspotCount: 2,
    hotspotSigmaM: 90,
    reportDelayMedianMin: 25,
    duplicateRate: 0.03,
    inaccurateRate: 0.03,
  },
  mixed: {
    intersectionShare: 0.3,
    hotspotShare: 0.2,
    rushShare: 0.35,
    hotspotCount: 8,
    hotspotSigmaM: 90,
    reportDelayMedianMin: 25,
    duplicateRate: 0.03,
    inaccurateRate: 0.025,
  },
};

const BASE_HOUR_WEIGHTS = [0.6, 0.4, 0.3, 0.3, 0.4, 0.9, 2.0, 2.8, 3.0, 2.4, 2.2, 2.3, 2.5, 2.4, 2.3, 2.6, 3.2, 3.6, 3.2, 2.5, 1.8, 1.4, 1.1, 0.8];
const RUSH_HOUR_WEIGHTS = BASE_HOUR_WEIGHTS.map((w, h) => (h >= 7 && h <= 8 ? w * 3.4 : h >= 16 && h <= 18 ? w * 3.0 : w));
const DOW_WEIGHTS = [1.0, 1.0, 1.0, 1.05, 1.15, 0.9, 0.7]; // Mon..Sun
const MONTH_WEIGHTS = [1.2, 1.1, 1.0, 0.95, 0.95, 1.0, 1.05, 1.05, 1.0, 1.05, 1.15, 1.2];
const CATEGORY_BASE: Record<CategoryCode, number> = { rear_end: 0.3, side_impact: 0.22, pedestrian: 0.13, cyclist: 0.1, single_vehicle: 0.25 };
const EXPOSURE_CLASS_WEIGHT: Record<RoadClass, number> = { arterial: 2.4, collector: 1.2, local: 0.5 };

export interface GenNode {
  index: number;
  x: number;
  y: number;
  lon: number;
  lat: number;
  degree: number;
}

export interface GenSegment {
  index: number;
  code: string;
  name: string;
  roadClass: RoadClass;
  speedLimitKmh: number;
  lanes: number;
  lighting: number;
  lengthM: number;
  startNode: number;
  endNode: number;
  a: Position;
  b: Position;
  lonLat: Position[];
  midLon: number;
  midLat: number;
}

export interface GenNetwork {
  nodes: GenNode[];
  segments: GenSegment[];
  hotspotNodes: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Builds a jittered rectangular grid of arterials, collectors and local streets. */
export function generateNetwork(seed: number): GenNetwork {
  const rng = mulberry32(seed ^ 0x9e3779b9);
  const n = STUDY_AREA.nodesPerSide;
  const spacing = STUDY_AREA.nodeSpacingM;
  const half = (n - 1) / 2;
  const [cx, cy] = STUDY_CENTER_UTM;

  const nodes: GenNode[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = cx + (i - half) * spacing + uniform(rng, -45, 45);
      const y = cy + (j - half) * spacing + uniform(rng, -45, 45);
      const [lon, lat] = utmToLonLat(x, y);
      nodes.push({ index: j * n + i, x, y, lon, lat, degree: 0 });
    }
  }

  const segments: GenSegment[] = [];
  const classOfLine = (k: number): RoadClass => (k % 4 === 0 ? "arterial" : k % 2 === 0 ? "collector" : "local");
  const addSegment = (na: GenNode, nb: GenNode, roadClass: RoadClass, name: string) => {
    const lengthM = Math.hypot(nb.x - na.x, nb.y - na.y);
    const meta = ROAD_CLASS_META[roadClass];
    const base = roadClass === "arterial" ? 0.82 : roadClass === "collector" ? 0.6 : 0.42;
    const lighting = clamp(base + normal(rng, 0, 0.12), 0, 1);
    const index = segments.length;
    segments.push({
      index,
      code: `SEG-${String(index + 1).padStart(4, "0")}`,
      name,
      roadClass,
      speedLimitKmh: meta.speedKmh,
      lanes: meta.lanes,
      lighting: Math.round(lighting * 1000) / 1000,
      lengthM: Math.round(lengthM * 10) / 10,
      startNode: na.index,
      endNode: nb.index,
      a: [na.x, na.y],
      b: [nb.x, nb.y],
      lonLat: [
        [na.lon, na.lat],
        [nb.lon, nb.lat],
      ],
      midLon: (na.lon + nb.lon) / 2,
      midLat: (na.lat + nb.lat) / 2,
    });
    na.degree++;
    nb.degree++;
  };

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n - 1; i++) {
      const cls = classOfLine(j);
      if (cls === "local" && rng() < 0.08) continue;
      addSegment(nodes[j * n + i]!, nodes[j * n + i + 1]!, cls, `${ROAD_CLASS_META[cls].label} ${j + 1} · E–W block ${i + 1}`);
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n - 1; j++) {
      const cls = classOfLine(i);
      if (cls === "local" && rng() < 0.08) continue;
      addSegment(nodes[j * n + i]!, nodes[(j + 1) * n + i]!, cls, `${ROAD_CLASS_META[cls].label} ${i + 1} · N–S block ${j + 1}`);
    }
  }

  // Hotspot junctions: interior nodes with full degree (4 incident segments).
  const interior = nodes.filter((nd) => nd.degree === 4);
  const shuffled = [...interior];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const hotspotNodes = shuffled.slice(0, 8).map((nd) => nd.index);

  return { nodes, segments, hotspotNodes };
}

export interface GenTraffic {
  segmentIndex: number;
  year: number;
  aadt: number;
  peakHourShare: number;
  heavyVehicleShare: number;
}

export function generateTraffic(seed: number, segments: GenSegment[], years: number[]): GenTraffic[] {
  const rng = mulberry32(seed ^ 0x51ed270b);
  const base: Record<RoadClass, number> = { arterial: 22000, collector: 8000, local: 1800 };
  const out: GenTraffic[] = [];
  for (const seg of segments) {
    const factor = Math.exp(normal(rng, 0, 0.25));
    for (const year of years) {
      const growth = 1 + 0.012 * (year - years[0]!);
      out.push({
        segmentIndex: seg.index,
        year,
        aadt: Math.round(base[seg.roadClass] * factor * growth),
        peakHourShare: Math.round(clamp(0.085 + normal(rng, 0, 0.01), 0.05, 0.15) * 1000) / 1000,
        heavyVehicleShare: Math.round(clamp(0.06 + (seg.roadClass === "arterial" ? 0.03 : 0) + normal(rng, 0, 0.02), 0.01, 0.3) * 1000) / 1000,
      });
    }
  }
  return out;
}

export interface WeatherStation {
  code: string;
  name: string;
  lon: number;
  lat: number;
}

export const WEATHER_STATIONS: WeatherStation[] = (() => {
  const offsets = [
    { code: "WX-N", name: "North station (synthetic)", dx: -1800, dy: 2100 },
    { code: "WX-E", name: "East station (synthetic)", dx: 2300, dy: -600 },
    { code: "WX-S", name: "South station (synthetic)", dx: 300, dy: -2400 },
  ];
  return offsets.map((o) => {
    const [lon, lat] = utmToLonLat(STUDY_CENTER_UTM[0] + o.dx, STUDY_CENTER_UTM[1] + o.dy);
    return { code: o.code, name: o.name, lon, lat };
  });
})();

export interface GenWeatherHour {
  stationCode: string;
  stationName: string;
  lon: number;
  lat: number;
  observedAt: Date;
  precipitationMm: number;
  temperatureC: number;
  visibilityM: number;
  windSpeedMs: number;
}

/** Hourly weather with seasonal and diurnal cycles and a Markov wet/dry chain per station. */
export function generateWeather(seed: number, startUtc: Date, endUtc: Date): GenWeatherHour[] {
  const hours = Math.floor((endUtc.getTime() - startUtc.getTime()) / 3_600_000) + 1;
  const out: GenWeatherHour[] = [];
  WEATHER_STATIONS.forEach((station, si) => {
    const rng = mulberry32(seed + 7919 * (si + 1));
    let wet = false;
    for (let h = 0; h < hours; h++) {
      const t = startUtc.getTime() + h * 3_600_000;
      const doy = (t / 86_400_000) % 365.25;
      const season = Math.cos((2 * Math.PI * (doy - 15)) / 365.25); // +1 mid-winter, -1 mid-summer
      const utcHour = new Date(t).getUTCHours();
      wet = wet ? rng() < 0.7 : rng() < 0.035 + 0.02 * season;
      const precipitationMm = wet ? Math.round(exponential(rng, 1.2 + 0.4 * (season + 1) / 2) * 100) / 100 : 0;
      const temperatureC = 10.5 - 9 * season + 4 * Math.sin((2 * Math.PI * (utcHour - 9)) / 24) + normal(rng, 0, 1.2);
      const visibilityM = Math.round(clamp(10000 - precipitationMm * 900 - (rng() < 0.03 ? 4000 : 0), 300, 10000));
      const windSpeedMs = Math.max(0, Math.round(normal(rng, 3.2 + (wet ? 1.5 : 0), 1.3) * 10) / 10);
      out.push({
        stationCode: station.code,
        stationName: station.name,
        lon: station.lon,
        lat: station.lat,
        observedAt: new Date(t),
        precipitationMm,
        temperatureC: Math.round(temperatureC * 10) / 10,
        visibilityM,
        windSpeedMs,
      });
    }
  });
  return out;
}

export interface GenAccident {
  occurredAt: Date;
  reportedAt: Date;
  reportingDelayMin: number;
  x: number;
  y: number;
  lon: number;
  lat: number;
  reportedAccuracyM: number | null;
  categoryCode: CategoryCode;
  severityId: 1 | 2 | 3 | 4;
  vehiclesInvolved: number;
  emergencyServices: boolean;
  description: string;
  status: "reported" | "verified" | "rejected" | "duplicate";
  duplicateOfIndex: number | null;
  injected: "none" | "duplicate" | "inaccurate";
  trackingCode: string | null;
}

export interface AccidentGenOptions {
  seed: number;
  scenario: ScenarioId;
  count: number;
  kind: "synthetic" | "citizen";
  startLocal: string;
  endLocal: string;
}

export interface AccidentGenResult {
  accidents: GenAccident[];
  injected: { duplicates: number; inaccurate: number };
}

const PHRASES: Record<CategoryCode, string[]> = {
  rear_end: ["Rear-end collision in slowing traffic", "Following vehicle failed to stop in time", "Vehicle struck the rear of a stationary car"],
  side_impact: ["Angle collision while turning across traffic", "Side impact at a junction approach", "Vehicles collided during a lane change near the junction"],
  pedestrian: ["Pedestrian struck while crossing away from the crossing", "Pedestrian struck at a marked crossing", "Pedestrian struck near a bus stop"],
  cyclist: ["Cyclist collided with a passing vehicle", "Cyclist struck during a right turn", "Cyclist involved in a door-zone collision"],
  single_vehicle: ["Vehicle left the carriageway and struck a fixed object", "Loss of control on a wet carriageway", "Single-vehicle run-off on a curve"],
};

function localDays(startLocal: string, endLocal: string) {
  const [sy, sm, sd] = startLocal.split("-").map(Number) as [number, number, number];
  const [ey, em, ed] = endLocal.split("-").map(Number) as [number, number, number];
  const days: { y: number; m: number; d: number; dow: number }[] = [];
  const end = Date.UTC(ey, em - 1, ed);
  for (let t = Date.UTC(sy, sm - 1, sd); t <= end; t += 86_400_000) {
    const dt = new Date(t);
    days.push({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), dow: (dt.getUTCDay() + 6) % 7 });
  }
  return days;
}

export function generateAccidents(net: GenNetwork, opts: AccidentGenOptions): AccidentGenResult {
  const rng = mulberry32(opts.seed);
  const cfg = SCENARIO_CONFIG[opts.scenario];
  const tz = STUDY_AREA.timeZone;
  const baseCount = Math.max(1, Math.round(opts.count / (1 + cfg.duplicateRate)));

  const days = localDays(opts.startLocal, opts.endLocal);
  const firstYear = days[0]?.y ?? 2022;
  const dayCum = cumulative(days.map((d) => DOW_WEIGHTS[d.dow]! * MONTH_WEIGHTS[d.m - 1]! * (1 + 0.04 * (d.y - firstYear))));
  const baseHourCum = cumulative(BASE_HOUR_WEIGHTS);
  const rushHourCum = cumulative(RUSH_HOUR_WEIGHTS);
  const segCum = cumulative(net.segments.map((s) => s.lengthM * EXPOSURE_CLASS_WEIGHT[s.roadClass]));
  const nodeCum = cumulative(net.nodes.map((nd) => nd.degree));
  const incident: number[][] = net.nodes.map(() => []);
  net.segments.forEach((s) => {
    incident[s.startNode]!.push(s.index);
    incident[s.endNode]!.push(s.index);
  });
  const hotspots = net.hotspotNodes.slice(0, cfg.hotspotCount);

  const pointAlongFromNode = (nodeIdx: number, meters: number): { x: number; y: number; seg: GenSegment } => {
    const options = incident[nodeIdx]!;
    const seg = net.segments[options[Math.floor(rng() * options.length)]!]!;
    const len = seg.lengthM;
    const d = Math.min(len * 0.45, Math.abs(meters));
    const t = seg.startNode === nodeIdx ? d / len : 1 - d / len;
    return { x: seg.a[0] + t * (seg.b[0] - seg.a[0]), y: seg.a[1] + t * (seg.b[1] - seg.a[1]), seg };
  };

  const accidents: GenAccident[] = [];
  let inaccurate = 0;

  for (let i = 0; i < baseCount; i++) {
    const day = days[sampleCumulative(rng, dayCum)]!;
    const rushDraw = rng() < cfg.rushShare;
    const hour = sampleCumulative(rng, rushDraw ? rushHourCum : baseHourCum);
    const minute = Math.floor(rng() * 60);
    const occurredAt = zonedToUtc(day.y, day.m, day.d, hour, minute, tz);

    const u = rng();
    let x: number;
    let y: number;
    let seg: GenSegment;
    let nearJunction = false;
    if (cfg.hotspotCount > 0 && u < cfg.hotspotShare && hotspots.length) {
      const hub = hotspots[Math.floor(rng() * hotspots.length)]!;
      const p = pointAlongFromNode(hub, Math.abs(normal(rng, 0, cfg.hotspotSigmaM)));
      ({ x, y, seg } = p);
      nearJunction = true;
    } else if (u < cfg.hotspotShare + cfg.intersectionShare) {
      const hub = sampleCumulative(rng, nodeCum);
      const p = pointAlongFromNode(hub, exponential(rng, 30));
      ({ x, y, seg } = p);
      nearJunction = true;
    } else {
      seg = net.segments[sampleCumulative(rng, segCum)]!;
      const t = rng();
      x = seg.a[0] + t * (seg.b[0] - seg.a[0]);
      y = seg.a[1] + t * (seg.b[1] - seg.a[1]);
    }
    // Lateral offset from the centreline (lane position, GPS-like noise).
    const nx = -(seg.b[1] - seg.a[1]) / seg.lengthM;
    const ny = (seg.b[0] - seg.a[0]) / seg.lengthM;
    const lateral = normal(rng, 0, 3);
    x += nx * lateral;
    y += ny * lateral;

    let accuracy: number | null = null;
    let injected: GenAccident["injected"] = "none";
    if (rng() < cfg.inaccurateRate) {
      const theta = uniform(rng, 0, 2 * Math.PI);
      const dist = uniform(rng, 150, 400);
      x += Math.cos(theta) * dist;
      y += Math.sin(theta) * dist;
      injected = "inaccurate";
      accuracy = 250;
      inaccurate++;
    } else if (opts.kind === "citizen") {
      accuracy = Math.round(uniform(rng, 5, 40));
    }

    const night = hour >= 22 || hour < 5;
    const peak = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
    const w: Record<CategoryCode, number> = { ...CATEGORY_BASE };
    if (nearJunction) {
      w.side_impact *= 1.9;
      w.rear_end *= 1.3;
    }
    if (seg.roadClass === "arterial") {
      w.rear_end *= 1.4;
      w.side_impact *= 1.2;
    }
    if (seg.roadClass === "local") {
      w.pedestrian *= 1.7;
      w.single_vehicle *= 1.1;
    }
    if (seg.roadClass === "collector") w.cyclist *= 1.6;
    if (night) {
      w.single_vehicle *= 1.6;
      w.pedestrian *= 0.7;
      w.rear_end *= 0.6;
    }
    if (peak) w.rear_end *= 1.5;
    const categoryCode = CATEGORY_CODES[weightedIndex(rng, CATEGORY_CODES.map((c) => w[c]))]!;

    const sevWeights = [0.62, 0.26, 0.1, 0.02];
    if (categoryCode === "pedestrian") sevWeights.splice(0, 4, 0.3, 0.35, 0.27, 0.08);
    if (categoryCode === "cyclist") sevWeights.splice(0, 4, 0.42, 0.32, 0.2, 0.06);
    if (seg.speedLimitKmh >= 60) {
      sevWeights[2]! *= 1.3;
      sevWeights[3]! *= 1.5;
    }
    if (night && categoryCode === "single_vehicle") {
      sevWeights[2]! *= 1.4;
      sevWeights[3]! *= 1.4;
    }
    const severityId = (weightedIndex(rng, sevWeights) + 1) as 1 | 2 | 3 | 4;

    const vehicles =
      categoryCode === "pedestrian" || categoryCode === "cyclist"
        ? (rng() < 0.8 ? 1 : 2)
        : categoryCode === "single_vehicle"
          ? 1
          : categoryCode === "rear_end"
            ? [2, 2, 2, 2, 3, 3, 4][Math.floor(rng() * 7)]!
            : rng() < 0.9
              ? 2
              : 3;
    const emergencyServices = rng() < [0.04, 0.4, 0.9, 0.99][severityId - 1]!;

    const delayMedian = opts.kind === "citizen" ? 150 : cfg.reportDelayMedianMin;
    const delayMin = Math.min(14 * 1440, Math.max(0, Math.round(logNormal(rng, delayMedian, 1.0))));
    const reportedAt = new Date(occurredAt.getTime() + delayMin * 60_000);
    const [lon, lat] = utmToLonLat(x, y);

    let status: GenAccident["status"] = "verified";
    if (opts.kind === "citizen") {
      const r = rng();
      status = r < 0.6 ? "verified" : r < 0.85 ? "reported" : "rejected";
    }

    const phrases = PHRASES[categoryCode];
    const phrase = phrases[Math.floor(rng() * phrases.length)]!;
    accidents.push({
      occurredAt,
      reportedAt,
      reportingDelayMin: delayMin,
      x,
      y,
      lon,
      lat,
      reportedAccuracyM: accuracy,
      categoryCode,
      severityId,
      vehiclesInvolved: vehicles,
      emergencyServices,
      description: `${phrase} near ${seg.name}. [synthetic record]`,
      status,
      duplicateOfIndex: null,
      injected,
      trackingCode: opts.kind === "citizen" ? `UAI-${randomCode(rng, 4)}-${randomCode(rng, 4)}` : null,
    });
  }

  // Duplicates: re-reports of an existing incident with small spatial and temporal jitter.
  const dupCount = Math.max(0, opts.count - baseCount);
  let duplicates = 0;
  for (let k = 0; k < dupCount; k++) {
    let origIdx = Math.floor(rng() * accidents.length);
    for (let tries = 0; tries < 10 && accidents[origIdx]!.status === "rejected"; tries++) {
      origIdx = Math.floor(rng() * accidents.length);
    }
    const orig = accidents[origIdx]!;
    const x = orig.x + normal(rng, 0, 25);
    const y = orig.y + normal(rng, 0, 25);
    const occurredAt = new Date(orig.occurredAt.getTime() + uniform(rng, 5, 90) * 60_000);
    const delayMin = Math.max(1, Math.round(logNormal(rng, opts.kind === "citizen" ? 150 : cfg.reportDelayMedianMin, 1.0)));
    const [lon, lat] = utmToLonLat(x, y);
    accidents.push({
      ...orig,
      occurredAt,
      reportedAt: new Date(occurredAt.getTime() + delayMin * 60_000),
      reportingDelayMin: delayMin,
      x,
      y,
      lon,
      lat,
      reportedAccuracyM: opts.kind === "citizen" ? Math.round(uniform(rng, 5, 60)) : null,
      description: `Second report of the same incident. ${orig.description}`,
      status: opts.kind === "citizen" ? "duplicate" : "reported",
      duplicateOfIndex: origIdx,
      injected: "duplicate",
      trackingCode: opts.kind === "citizen" ? `UAI-${randomCode(rng, 4)}-${randomCode(rng, 4)}` : null,
    });
    duplicates++;
  }

  return { accidents, injected: { duplicates, inaccurate } };
}


