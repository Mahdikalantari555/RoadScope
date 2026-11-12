/**
 * Synthetic accident dataset generator.
 *
 * All output is explicitly labelled synthetic. A fixed seed reproduces every
 * record, including injected data-quality artefacts (duplicates, coarse
 * geocoding, pending citizen submissions) used to exercise the moderation and
 * uncertainty workflows.
 */
import { project, pointToSegment, type XY } from "../geo";
import { cityProjection, type GeneratedCity, type GeneratedSegment } from "./city";
import { Random } from "./random";

export type ScenarioKey = "mixed" | "intersection" | "rush_hour" | "uniform";

export const SCENARIOS: { key: ScenarioKey; label: string; description: string }[] = [
  {
    key: "mixed",
    label: "Mixed urban patterns",
    description:
      "Composite scenario: 45 % junction clusters, 27 % arterial corridors, 20 % dispersed background, 8 % ring-road/high-speed corridors.",
  },
  {
    key: "intersection",
    label: "Intersection-dominated",
    description: "72 % of events clustered around nine signalised junctions, remainder along corridors.",
  },
  {
    key: "rush_hour",
    label: "Rush-hour-dominated",
    description:
      "Spatially mixed, but 68 % of timestamps inside 07:00–09:00 and 16:00–19:00 with a Friday peak.",
  },
  {
    key: "uniform",
    label: "Uniform background",
    description: "Complete spatial randomness over the built-up area with a flat temporal profile.",
  },
];

export const REGISTER_DATASET = {
  slug: "vnt-register",
  name: "Vantia synthetic accident register",
  kind: "synthetic",
  description:
    "Modelled municipal accident register for the synthetic city of Vantia. Generated with a fixed seed; contains no real incidents.",
  citation: "Urban Accident Intelligence synthetic generator v1.0 (2026).",
};

export const CITIZEN_DATASET = {
  slug: "vnt-citizen",
  name: "Vantia synthetic citizen submissions",
  kind: "synthetic",
  description:
    "Simulated crowdsourced submissions, including pending, rejected and duplicate reports used for data-quality workflows.",
  citation: "Urban Accident Intelligence synthetic generator v1.0 (2026).",
};

export const CATEGORIES = [
  { code: "rear_end", label: "Rear-end collision", color: "#38bdf8", weight: 0.24 },
  { code: "junction_turn", label: "Junction / turning", color: "#a78bfa", weight: 0.21 },
  { code: "pedestrian", label: "Pedestrian involved", color: "#fb7185", weight: 0.13 },
  { code: "cyclist", label: "Cyclist involved", color: "#34d399", weight: 0.12 },
  { code: "single_vehicle", label: "Single vehicle", color: "#94a3b8", weight: 0.1 },
  { code: "head_on", label: "Head-on", color: "#f97316", weight: 0.06 },
  { code: "overtaking", label: "Overtaking / lane change", color: "#facc15", weight: 0.08 },
  { code: "parked", label: "Parked vehicle", color: "#64748b", weight: 0.06 },
] as const;

export const SEVERITIES = [
  { code: 1, label: "Property damage only", weight: 1, color: "#64748b" },
  { code: 2, label: "Slight injury", weight: 3, color: "#eab308" },
  { code: 3, label: "Serious injury", weight: 7, color: "#f97316" },
  { code: 4, label: "Fatal", weight: 12, color: "#ef4444" },
] as const;

export type GeneratedAccident = {
  publicId: string;
  datasetSlug: string;
  status: "reported" | "verified" | "rejected" | "duplicate";
  categoryCode: string;
  severityCode: number;
  occurredAt: Date;
  reportedAt: Date;
  lat: number;
  lng: number;
  originalLat: number;
  originalLng: number;
  positionalUncertaintyM: number;
  locationMethod: string;
  geom: { type: "Point"; coordinates: [number, number] };
  district: string;
  roadSegmentId: string | null;
  vehicles: number;
  casualties: number;
  fatalities: number;
  emergencyServices: boolean;
  description: string;
  weather: string | null;
  roadSurface: string | null;
  lighting: string | null;
  hour: number;
  dow: number;
  month: number;
  duplicateOfIndex: number | null;
  duplicateScore: number | null;
  qualityFlags: string[];
  reporterRole: "register" | "citizen";
};

export type GeneratedEnvironment = {
  district: string;
  lat: number;
  lng: number;
  observedAt: Date;
  daypart: string;
  condition: string;
  precipitationMm: number;
  temperatureC: number;
  visibilityM: number;
  roadSurface: string;
  lighting: string;
};

const REFERENCE = Date.UTC(2025, 11, 31, 23, 0, 0);
const START = Date.UTC(2023, 11, 1, 0, 0, 0);

const MONTH_WEIGHTS = [1.16, 0.94, 0.95, 0.92, 0.96, 0.88, 0.86, 0.9, 1.04, 1.12, 1.18, 1.2];
const DOW_WEIGHTS = [0.78, 1.02, 1.03, 1.01, 1.12, 1.26, 0.86]; // Sun..Sat
const HOUR_WEIGHTS_BASE = [
  0.42, 0.3, 0.24, 0.2, 0.2, 0.3, 0.58, 1.02, 1.5, 1.16, 0.96, 0.94, 1.0, 0.98, 1.02, 1.22, 1.62,
  1.72, 1.46, 1.1, 0.9, 0.82, 0.74, 0.56,
];
const HOUR_WEIGHTS_RUSH = [
  0.18, 0.12, 0.1, 0.08, 0.1, 0.16, 0.4, 1.4, 2.6, 1.6, 0.9, 0.7, 0.7, 0.7, 0.9, 1.6, 2.7, 2.9,
  2.0, 1.2, 0.8, 0.6, 0.4, 0.26,
];

const DAYPARTS = ["night", "morning_peak", "day", "evening_peak"] as const;

function daypartOf(hour: number): string {
  if (hour >= 7 && hour < 10) return "morning_peak";
  if (hour >= 16 && hour < 19) return "evening_peak";
  if (hour >= 10 && hour < 16) return "day";
  return "night";
}

function daylight(month: number, hour: number): "daylight" | "twilight" | "dark" {
  // Northern-hemisphere style daylight envelope for the synthetic study area.
  const sunrise = 7.8 - 1.9 * Math.sin(((month - 2) / 12) * Math.PI * 2);
  const sunset = 17.4 + 2.6 * Math.sin(((month - 5) / 12) * Math.PI * 2);
  if (hour + 0.5 >= sunrise && hour + 0.5 <= sunset) return "daylight";
  if ((hour >= sunrise - 1 && hour < sunrise) || (hour > sunset && hour <= sunset + 1)) return "twilight";
  return "dark";
}

function sampleWeather(rnd: Random, month: number): { weather: string; surface: string; precipitation: number } {
  const wetBias = [0.28, 0.24, 0.2, 0.16, 0.15, 0.14, 0.13, 0.15, 0.17, 0.22, 0.27, 0.3][month - 1];
  const r = rnd.uniform();
  if (r < wetBias * 0.22) return { weather: "heavy_rain", surface: "standing water", precipitation: rnd.uniform(4, 14) };
  if (r < wetBias * 0.62) return { weather: "rain", surface: "wet", precipitation: rnd.uniform(0.4, 4) };
  if (r < wetBias * 0.72) return { weather: "fog", surface: "damp", precipitation: 0 };
  if (r < wetBias + 0.18) return { weather: "cloudy", surface: "dry", precipitation: 0 };
  return { weather: "clear", surface: "dry", precipitation: 0 };
}

const ADJECTIVES = [
  "westbound approach",
  "northbound carriageway",
  "signal-controlled junction",
  "cycle crossing",
  "bus stop lay-by",
  "reduced-visibility bend",
  "main carriageway",
  "side-road exit",
];
const NARRATIVES: Record<string, string[]> = {
  rear_end: [
    "Lead vehicle braked sharply at the {adj}; the following driver reported a delayed reaction.",
    "Queuing traffic on the {adj} resulted in a low-speed rear-end impact.",
  ],
  junction_turn: [
    "Turning vehicle failed to yield at the {adj}.",
    "Two vehicles collided while entering the {adj} on conflicting phases.",
  ],
  pedestrian: [
    "Pedestrian struck while crossing the {adj} outside a marked crossing.",
    "Collision occurred as a pedestrian stepped out at the {adj}.",
  ],
  cyclist: [
    "Cyclist was struck at the {adj} during a lane merge.",
    "Vehicle turned across the cycle lane at the {adj}.",
  ],
  single_vehicle: [
    "Single vehicle lost traction at the {adj} and struck street furniture.",
    "Driver reported a swerve to avoid an obstacle at the {adj}.",
  ],
  head_on: [
    "Opposing flows conflicted at the {adj}.",
    "Overtaking manoeuvre on the {adj} ended in a head-on impact.",
  ],
  overtaking: [
    "Lane-change collision reported on the {adj}.",
    "Overtaking vehicle misjudged the gap at the {adj}.",
  ],
  parked: [
    "Moving vehicle clipped a parked car on the {adj}.",
    "Wing-mirror strike on a parked vehicle at the {adj}.",
  ],
};

const VEHICLES_BY_CATEGORY: Record<string, [number, number]> = {
  rear_end: [2, 3],
  junction_turn: [2, 3],
  pedestrian: [1, 2],
  cyclist: [1, 2],
  single_vehicle: [1, 1],
  head_on: [2, 2],
  overtaking: [2, 3],
  parked: [1, 2],
};

function nearestSegment(
  lat: number,
  lng: number,
  projected: { seg: GeneratedSegment; a: XY; b: XY }[],
): { segment: GeneratedSegment | null; distance: number } {
  const p = project({ lat, lng }, cityProjection);
  let best: { segment: GeneratedSegment | null; distance: number } = { segment: null, distance: Infinity };
  for (const item of projected) {
    const d = pointToSegment(p, item.a, item.b).distance;
    if (d < best.distance) best = { segment: item.seg, distance: d };
  }
  return best;
}

export function generateAccidents(
  city: GeneratedCity,
  scenario: ScenarioKey,
  count: number,
  seed = 20_260_117,
): {
  accidents: GeneratedAccident[];
  environment: GeneratedEnvironment[];
  traffic: { segmentId: string; daypart: string; observedAt: Date; aadt: number; heavyVehiclePct: number }[];
  metadata: { seed: number; scenario: ScenarioKey; count: number; hotIntersections: string[] };
} {
  const rnd = new Random(seed);
  const rndMeta = new Random(seed + 1);
  const segments = city.segments;
  const projected = segments.map((seg) => ({
    seg,
    a: project({ lat: seg.startLat, lng: seg.startLng }, cityProjection),
    b: project({ lat: seg.endLat, lng: seg.endLng }, cityProjection),
  }));

  const signalised = city.intersections.filter((i) => i.isSignalised);
  const hot = rndMeta.shuffle(signalised).slice(0, 9);
  const hotWeights = hot.map((_, i) => 1 / (1 + i * 0.35));
  const ringSegments = segments.filter((s) => s.roadClass === "ring");
  const arterialSegments = segments.filter((s) => s.roadClass === "arterial");
  const segmentWeights = segments.map((s) => Math.max(1, s.aadt ?? 1000));

  const candidates: Omit<GeneratedAccident, "publicId">[] = [];

  const pickTime = (): Date => {
    const hourWeights = scenario === "rush_hour" ? HOUR_WEIGHTS_RUSH : HOUR_WEIGHTS_BASE;
    const month = rnd.weighted(MONTH_WEIGHTS.map((w, i) => ({ value: i + 1, weight: w })));
    const dow = rnd.weighted(DOW_WEIGHTS.map((w, i) => ({ value: i, weight: w })));
    const hour = rnd.weighted(hourWeights.map((w, i) => ({ value: i, weight: w })));
    // find a date with matching month/dow within the study window
    const startDate = new Date(START);
    const endDate = new Date(REFERENCE);
    const options: Date[] = [];
    for (let t = startDate.getTime(); t <= endDate.getTime(); t += 86_400_000) {
      const d = new Date(t);
      if (d.getUTCMonth() + 1 === month && d.getUTCDay() === dow) options.push(d);
    }
    const base = options.length > 0 ? options[Math.floor(rnd.uniform(0, options.length))] : startDate;
    return new Date(base.getTime() + hour * 3_600_000 + rnd.int(0, 59) * 60_000);
  };

  const sampleLocation = (): { lat: number; lng: number; context: string } => {
    const roll = rnd.uniform();
    if (scenario === "uniform") {
      const dist = rnd.uniform(0, 4700);
      const bearing = rnd.uniform(0, Math.PI * 2);
      const lat = city.center.lat + (Math.sin(bearing) * dist) / 111_132;
      const lng = city.center.lng + (Math.cos(bearing) * dist) / 68_000;
      return { lat, lng, context: "background" };
    }
    if (scenario === "intersection" ? roll < 0.72 : roll < 0.45) {
      const idx = rnd.weighted(hotWeights.map((w, i) => ({ value: i, weight: w })));
      const anchor = hot[idx];
      const sigma = rnd.uniform(35, 115);
      return {
        lat: anchor.lat + rnd.normal(0, sigma) / 111_132,
        lng: anchor.lng + rnd.normal(0, sigma) / 68_000,
        context: `junction:${anchor.name}`,
      };
    }
    if (roll < (scenario === "intersection" ? 0.87 : 0.72)) {
      const seg = rnd.weighted(arterialSegments.map((s) => ({ value: s, weight: 1 })));
      const t = rnd.uniform(0.05, 0.95);
      const lat = seg.startLat + (seg.endLat - seg.startLat) * t + rnd.normal(0, 9) / 111_132;
      const lng = seg.startLng + (seg.endLng - seg.startLng) * t + rnd.normal(0, 9) / 68_000;
      return { lat, lng, context: `corridor:${seg.name}` };
    }
    if (roll < 0.92) {
      const weighted = segments.map((s, i) => ({ value: s, weight: segmentWeights[i] }));
      const seg = rnd.weighted(weighted);
      const t = rnd.uniform(0, 1);
      return {
        lat: seg.startLat + (seg.endLat - seg.startLat) * t + rnd.normal(0, 12) / 111_132,
        lng: seg.startLng + (seg.endLng - seg.startLng) * t + rnd.normal(0, 12) / 68_000,
        context: `network:${seg.name}`,
      };
    }
    const seg = rnd.pick(ringSegments.length > 0 ? ringSegments : segments);
    return {
      lat: seg.startLat + (seg.endLat - seg.startLat) * rnd.uniform(0.2, 0.8),
      lng: seg.startLng + (seg.endLng - seg.startLng) * rnd.uniform(0.2, 0.8),
      context: "ring",
    };
  };

  const registerCount = Math.round(count * 0.7);
  for (let i = 0; i < count; i += 1) {
    const isRegister = i < registerCount;
    const occurredAt = pickTime();
    const month = occurredAt.getUTCMonth() + 1;
    const hour = occurredAt.getUTCHours();
    const dow = occurredAt.getUTCDay();
    const loc = sampleLocation();
    const near = nearestSegment(loc.lat, loc.lng, projected);
    const segment = near.segment;
    const envKnown = isRegister ? rnd.bool(0.92) : rnd.bool(0.55);
    const weatherSample = sampleWeather(rnd, month);
    const light = daylight(month, hour);
    const category = rnd.weighted(CATEGORIES.map((c) => ({ value: c, weight: c.weight })));

    const speed = segment?.speedLimitKmh ?? 40;
    const dark = light === "dark";
    const wet = weatherSample.surface !== "dry";
    let pFatal = 0.008 + Math.max(0, speed - 40) * 0.00085 + (dark ? 0.008 : 0) + (wet ? 0.004 : 0);
    let pSerious = 0.11 + Math.max(0, speed - 30) * 0.0022 + (dark ? 0.035 : 0) + (wet ? 0.02 : 0);
    if (category.code === "head_on") {
      pFatal += 0.035;
      pSerious += 0.14;
    }
    if (category.code === "pedestrian") {
      pFatal += 0.022;
      pSerious += 0.2;
    }
    if (category.code === "cyclist") {
      pFatal += 0.012;
      pSerious += 0.16;
    }
    if (category.code === "parked") {
      pFatal *= 0.05;
      pSerious *= 0.24;
    }
    if (category.code === "single_vehicle") pSerious += 0.06;
    const r = rnd.uniform();
    let severity = 1;
    if (r < pFatal) severity = 4;
    else if (r < pFatal + pSerious) severity = 3;
    else if (r < pFatal + pSerious + 0.42) severity = 2;

    const fatalities = severity === 4 ? 1 + (rnd.bool(0.12) ? 1 : 0) : 0;
    const injuries =
      severity === 3 ? rnd.int(1, 3) : severity === 2 ? rnd.int(1, 2) : severity === 4 ? rnd.int(0, 2) : 0;
    const [minVeh, maxVeh] = VEHICLES_BY_CATEGORY[category.code] ?? [1, 2];
    const vehicles = category.code === "pedestrian" || category.code === "cyclist" ? rnd.int(1, 2) : rnd.int(minVeh, maxVeh + 1);

    const uncertainty = isRegister
      ? rnd.uniform(4, 18)
      : rnd.weighted([
          { value: rnd.uniform(6, 15), weight: 0.5 },
          { value: rnd.uniform(15, 30), weight: 0.35 },
          { value: rnd.uniform(30, 60), weight: 0.15 },
        ]);
    const locationMethod = isRegister
      ? "register_record"
      : uncertainty > 28
        ? "address_geocode"
        : uncertainty > 16
          ? "map_pick"
          : "gps_device";

    const narrative = rnd.pick(NARRATIVES[category.code] ?? NARRATIVES.rear_end);
    const description = narrative.replace("{adj}", rnd.pick(ADJECTIVES));

    const delayMinutes = isRegister
      ? rnd.weighted([
          { value: rnd.uniform(20, 240), weight: 0.5 },
          { value: rnd.uniform(240, 2880), weight: 0.38 },
          { value: rnd.uniform(2880, 20160), weight: 0.12 },
        ])
      : rnd.weighted([
          { value: rnd.uniform(1, 25), weight: 0.55 },
          { value: rnd.uniform(25, 720), weight: 0.33 },
          { value: rnd.uniform(720, 5760), weight: 0.12 },
        ]);

    const qualityFlags: string[] = [];
    if (near.distance > 90) qualityFlags.push("position_offset_from_network");
    if (!envKnown) qualityFlags.push("environmental_context_missing");
    if (!isRegister && uncertainty > 28) qualityFlags.push("coarse_geocode");

    let status: "reported" | "verified" | "rejected" | "duplicate" = "verified";
    let reporterRole: "register" | "citizen" = "register";
    if (!isRegister) {
      reporterRole = "citizen";
      status = rnd.weighted([
        { value: "reported", weight: 0.6 },
        { value: "verified", weight: 0.24 },
        { value: "rejected", weight: 0.08 },
        { value: "duplicate", weight: 0.08 },
      ]);
    } else {
      const roll = rnd.uniform();
      if (roll < 0.02) status = "duplicate";
      else if (roll < 0.035) status = "rejected";
    }

    candidates.push({
      datasetSlug: isRegister ? REGISTER_DATASET.slug : CITIZEN_DATASET.slug,
      status,
      categoryCode: category.code,
      severityCode: severity,
      occurredAt,
      reportedAt: new Date(occurredAt.getTime() + delayMinutes * 60_000),
      lat: loc.lat,
      lng: loc.lng,
      originalLat: loc.lat,
      originalLng: loc.lng,
      positionalUncertaintyM: Math.round(uncertainty * 10) / 10,
      locationMethod,
      geom: { type: "Point", coordinates: [loc.lng, loc.lat] },
      district: segment?.district ?? city.districts[0].name,
      roadSegmentId: near.distance <= 70 ? segment?.id ?? null : null,
      vehicles,
      casualties: injuries + fatalities,
      fatalities,
      emergencyServices: severity >= 3 ? rnd.bool(0.92) : rnd.bool(0.24),
      description: `${description}${envKnown ? "" : " No environmental context supplied."}`,
      weather: envKnown ? weatherSample.weather : null,
      roadSurface: envKnown ? weatherSample.surface : null,
      lighting: envKnown ? light : null,
      hour,
      dow,
      month,
      duplicateOfIndex: null,
      duplicateScore: null,
      qualityFlags,
      reporterRole,
    });
  }

  // Inject duplicate relationships for records flagged as duplicates.
  const duplicates = candidates.filter((c) => c.status === "duplicate");
  duplicates.forEach((dup) => {
    const idx = candidates.indexOf(dup);
    const windowStart = dup.occurredAt.getTime() - 36 * 3600 * 1000;
    let bestIdx = -1;
    let bestScore = 0;
    for (let j = 0; j < candidates.length; j += 1) {
      if (j === idx) continue;
      const other = candidates[j];
      if (other.status === "duplicate") continue;
      const dt = Math.abs(other.occurredAt.getTime() - dup.occurredAt.getTime());
      if (dt > 36 * 3600 * 1000) continue;
      if (other.categoryCode !== dup.categoryCode) continue;
      const dist = Math.hypot((other.lat - dup.lat) * 111_132, (other.lng - dup.lng) * 68_000);
      if (dist > 400) continue;
      const score = Math.max(0, 1 - dist / 400) * 0.7 + Math.max(0, 1 - dt / (36 * 3600 * 1000)) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx >= 0) {
      dup.duplicateOfIndex = bestIdx;
      dup.duplicateScore = Math.round(bestScore * 1000) / 1000;
    }
  });

  const accidents: GeneratedAccident[] = candidates.map((c, i) => {
    const year = c.occurredAt.getUTCFullYear();
    return {
      ...c,
      publicId: `VNT-${year}-${String(i + 1).padStart(5, "0")}`,
    };
  });

  // Environmental observations — stratified by district and season.
  const environment: GeneratedEnvironment[] = [];
  const envRandom = new Random(seed + 7);
  city.districts.forEach((district) => {
    for (let season = 0; season < 4; season += 1) {
      for (let sample = 0; sample < 8; sample += 1) {
        const month = season * 3 + envRandom.int(1, 3);
        const day = envRandom.int(1, 27);
        const hour = envRandom.int(0, 23);
        const observedAt = new Date(Date.UTC(2025, month - 1, day, hour));
        const w = sampleWeather(envRandom, month);
        environment.push({
          district: district.name,
          lat: district.centroid.lat + envRandom.normal(0, 0.0016),
          lng: district.centroid.lng + envRandom.normal(0, 0.0026),
          observedAt,
          daypart: daypartOf(hour),
          condition: w.weather,
          precipitationMm: Math.round(w.precipitation * 10) / 10,
          temperatureC: Math.round((4 + 14 * Math.sin(((month - 4) / 12) * Math.PI * 2) + envRandom.normal(0, 2)) * 10) / 10,
          visibilityM: w.weather === "fog" ? envRandom.int(60, 400) : w.weather.includes("rain") ? envRandom.int(900, 4000) : envRandom.int(6000, 20000),
          roadSurface: w.surface,
          lighting: daylight(month, hour),
        });
      }
    }
  });

  const traffic = segments.flatMap((segment) =>
    ["morning_peak", "evening_peak"].map((daypart) => ({
      segmentId: segment.id,
      daypart,
      observedAt: new Date(Date.UTC(2025, 8, 16, daypart === "morning_peak" ? 8 : 17)),
      aadt: Math.round((segment.aadt ?? 1000) * (daypart === "morning_peak" ? 1.04 : 0.98)),
      heavyVehiclePct: segment.heavyVehiclePct ?? 3,
    })),
  );

  return {
    accidents,
    environment,
    traffic,
    metadata: { seed, scenario, count, hotIntersections: hot.map((h) => h.name) },
  };
}

export const DAYPARTS_REF = DAYPARTS;
