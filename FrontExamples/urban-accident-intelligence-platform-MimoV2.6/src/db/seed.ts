/**
 * Database seeder — materialises the deterministic synthetic dataset.
 *
 * Run: `npm run db:seed` (see package scripts) or `npx tsx src/db/seed.ts --scenario=mixed --seed=20240917`
 */

import "dotenv/config";
import { db, pool } from "./index";
import {
  accidents,
  accidentCategories,
  auditLogs,
  datasetSources,
  environmentalObservations,
  reportAttachments,
  reportVerifications,
  roadSegments,
  severityLevels,
  trafficObservations,
  users,
} from "./schema";
import { CATEGORIES, SEVERITIES } from "../lib/constants";
import {
  DEFAULT_CONFIG,
  generateAccidents,
  generateEnvironmental,
  generateNetwork,
  generateTraffic,
  mulberry32,
  type Scenario,
  type SyntheticConfig,
} from "../lib/synthetic";

const DAY_MS = 86400000;

export interface SeedResult {
  segments: number;
  accidents: number;
  environmental: number;
  traffic: number;
  attachments: number;
  verifications: number;
  durationMs: number;
}

export async function seedDatabase(cfg: SyntheticConfig = DEFAULT_CONFIG): Promise<SeedResult> {
  const t0 = Date.now();
  const { nodes, segments } = generateNetwork(cfg);
  const synthAccidents = generateAccidents(cfg, nodes, segments);
  const trafficRows = generateTraffic(cfg, segments);
  const envRows = generateEnvironmental(cfg, synthAccidents);

  // --- reset ------------------------------------------------------------
  await db.execute(`
    TRUNCATE TABLE
      report_verifications, report_attachments, environmental_observations,
      traffic_observations, spatial_analysis_results, spatial_analysis_jobs,
      accidents, road_segments, audit_logs, dataset_sources, accident_categories,
      severity_levels, users
    RESTART IDENTITY CASCADE;
  `);

  // --- vocabularies -----------------------------------------------------
  await db.insert(severityLevels).values(
    SEVERITIES.map((s) => ({
      code: s.code,
      label: s.label,
      rank: s.rank,
      weight: s.weight,
      colour: s.colour,
      definition: s.definition,
    })),
  );
  await db.insert(accidentCategories).values(
    CATEGORIES.map((c) => ({
      code: c.code,
      label: c.label,
      group: c.group,
      description: c.description,
    })),
  );

  // --- users ------------------------------------------------------------
  await db.insert(users).values([
    {
      email: "control@meridian-city.gov",
      name: "Meridian Traffic Control",
      role: "administrator",
      organisation: "Meridian City Transport Authority",
    },
    {
      email: "reviewer@meridian-city.gov",
      name: "A. Vasquez",
      role: "administrator",
      organisation: "Road Safety Investigation Unit",
    },
    {
      email: "citizen@meridian.example",
      name: "Contributor (anonymous)",
      role: "contributor",
      organisation: null,
    },
  ]);

  // --- dataset sources --------------------------------------------------
  const coverageStart = new Date("2024-01-06T00:00:00.000Z");
  const coverageEnd = new Date(coverageStart.getTime() + cfg.coverageDays * DAY_MS);
  await db.insert(datasetSources).values([
    {
      slug: "synthetic-meridian",
      name: "Meridian District synthetic accident corpus",
      kind: "synthetic",
      isSynthetic: true,
      description:
        "Deterministic synthetic corpus generated for demonstration and method development. Contains uniform, cluster and rush-hour components plus deliberately duplicated and imprecisely geocoded reports.",
      licence: "CC0-1.0 (generated data)",
      generatorVersion: "1.0.0",
      randomSeed: cfg.seed,
      recordCount: synthAccidents.length,
      coverageStart,
      coverageEnd,
    },
    {
      slug: "synthetic-road-network",
      name: "Meridian District synthetic road network",
      kind: "synthetic",
      isSynthetic: true,
      description:
        "Generated grid road network with arterials, collectors and local streets, junction control attributes and design speed.",
      licence: "CC0-1.0 (generated data)",
      generatorVersion: "1.0.0",
      randomSeed: cfg.seed ^ 0x9e3779b9,
      recordCount: segments.length,
      coverageStart,
      coverageEnd,
    },
    {
      slug: "traffic-model-meridian",
      name: "Synthetic traffic exposure model",
      kind: "synthetic",
      isSynthetic: true,
      description:
        "Hourly traffic volumes and mean speeds by road segment, derived from a synthetic capacity/demand model. Not observed traffic.",
      licence: "CC0-1.0 (generated data)",
      generatorVersion: "1.0.0",
      randomSeed: cfg.seed ^ 0x51ed270b,
      recordCount: trafficRows.length,
      coverageStart,
      coverageEnd,
    },
    {
      slug: "official-crash-registry",
      name: "Official crash registry (integration slot)",
      kind: "official",
      isSynthetic: false,
      description:
        "Reserved integration slot for a national or municipal crash registry. No records loaded in this build — the platform is fully functional without it.",
      licence: "n/a — no data loaded",
      generatorVersion: null,
      randomSeed: null,
      recordCount: 0,
      coverageStart: null,
      coverageEnd: null,
    },
  ]);

  // --- road network -----------------------------------------------------
  const segmentValues = segments.map((s) => ({
    segmentCode: s.segmentCode,
    streetName: s.streetName,
    roadClass: s.roadClass,
    district: s.district,
    fromNodeId: s.fromNodeId,
    toNodeId: s.toNodeId,
    lengthM: Math.round(s.lengthM * 100) / 100,
    bearingDeg: Math.round(s.bearingDeg * 100) / 100,
    speedLimitKph: s.speedLimitKph,
    lanes: s.lanes,
    lighting: s.lighting,
    surface: s.surface,
    hasJunctionControl: s.hasJunctionControl,
    hasCycleLane: s.hasCycleLane,
    centroidLon: s.centroidLon,
    centroidLat: s.centroidLat,
    geometryWkt: `LINESTRING(${s.coordinates.map((c) => `${c[0].toFixed(7)} ${c[1].toFixed(7)}`).join(", ")})`,
    geometryJson: { type: "LineString", coordinates: s.coordinates },
  }));
  for (let i = 0; i < segmentValues.length; i += 400) {
    await db.insert(roadSegments).values(segmentValues.slice(i, i + 400));
  }

  // --- accidents --------------------------------------------------------
  const rng = mulberry32(cfg.seed ^ 0x1000193);
  const accidentValues = synthAccidents.map((a, i) => ({
    publicId: a.publicId,
    categoryCode: a.categoryCode,
    severityCode: a.severityCode,
    roadSegmentId: a.segmentIndex == null ? null : a.segmentIndex + 1,
    lon: a.lon,
    lat: a.lat,
    reportedLon: a.reportedLon,
    reportedLat: a.reportedLat,
    positionalAccuracyM: Math.round(a.positionalAccuracyM * 100) / 100,
    geocodePrecision: a.geocodePrecision,
    occurredAt: a.occurredAt,
    reportedAt: a.reportedAt,
    reportDelayH: Math.round(a.reportDelayH * 100) / 100,
    vehicles: a.vehicles,
    casualties: a.casualties,
    description: a.description,
    emergencyServices: a.emergencyServices,
    status: a.status,
    duplicateOfId: a.duplicateOfIndex == null ? null : a.duplicateOfIndex + 1,
    rejectReason: a.rejectReason,
    reporterUserId: 3,
    reporterHandle: a.reporterHandle,
    isSynthetic: true,
    datasetSourceId: 1,
    lighting: a.lighting,
    weather: a.weather,
    roadSurface: a.roadSurface,
    createdAt: a.reportedAt,
    updatedAt: a.reportedAt,
  }));
  for (let i = 0; i < accidentValues.length; i += 400) {
    await db.insert(accidents).values(accidentValues.slice(i, i + 400));
  }

  // --- observations -----------------------------------------------------
  const trafficValues = trafficRows.map((r) => ({
    roadSegmentId: r.segmentIndex + 1,
    observedAt: new Date(coverageEnd.getTime() - (r.dayType === "weekend" ? 2 : 1) * DAY_MS * 2),
    hourOfDay: r.hourOfDay,
    dayType: r.dayType,
    volumeVehPerHour: r.volumeVehPerHour,
    avgSpeedKph: r.avgSpeedKph,
    aadt: r.aadt,
    congestionIndex: r.congestionIndex,
    coverageRatio: r.coverageRatio,
  }));
  for (let i = 0; i < trafficValues.length; i += 400) {
    await db.insert(trafficObservations).values(trafficValues.slice(i, i + 400));
  }

  const envValues = envRows.map((r) => {
    const a = synthAccidents[r.accidentIndex];
    return {
      accidentId: r.accidentIndex + 1,
      roadSegmentId: a.segmentIndex == null ? null : a.segmentIndex + 1,
      observedAt: a.occurredAt,
      weather: a.weather,
      temperatureC: r.temperatureC,
      visibilityM: r.visibilityM,
      precipitationMm: r.precipitationMm,
      windKph: r.windKph,
      roadSurfaceCondition: a.roadSurface,
      source: r.source,
    };
  });
  for (let i = 0; i < envValues.length; i += 400) {
    await db.insert(environmentalObservations).values(envValues.slice(i, i + 400));
  }

  // --- attachments & verifications -------------------------------------
  const attachmentValues: (typeof reportAttachments.$inferInsert)[] = [];
  const verificationValues: (typeof reportVerifications.$inferInsert)[] = [];
  synthAccidents.forEach((a, i) => {
    if (a.status !== "pending" && rng() < 0.92) {
      verificationValues.push({
        accidentId: i + 1,
        reviewerUserId: rng() < 0.5 ? 1 : 2,
        reviewerName: rng() < 0.5 ? "Meridian Traffic Control" : "A. Vasquez",
        decision: a.status === "duplicate" ? "duplicate" : a.status,
        confidence: Math.round((0.55 + rng() * 0.44) * 100) / 100,
        notes: a.rejectReason ?? "Cross-checked against the synthetic registry entry.",
      });
    }
    const attachRoll = rng();
    const count = attachRoll < 0.55 ? 0 : attachRoll < 0.88 ? 1 : 2;
    for (let k = 0; k < count; k++) {
      attachmentValues.push({
        accidentId: i + 1,
        filename: `evidence-${a.publicId.toLowerCase()}-${k + 1}.jpg`,
        contentType: "image/jpeg",
        byteSize: Math.round(180000 + rng() * 2400000),
        storageUrl: `synthetic://attachments/${a.publicId}/${k + 1}`,
        capturedAt: a.occurredAt,
      });
    }
  });
  for (let i = 0; i < attachmentValues.length; i += 400) {
    await db.insert(reportAttachments).values(attachmentValues.slice(i, i + 400));
  }
  for (let i = 0; i < verificationValues.length; i += 400) {
    await db.insert(reportVerifications).values(verificationValues.slice(i, i + 400));
  }

  // --- audit trail ------------------------------------------------------
  await db.insert(auditLogs).values([
    {
      actorUserId: 1,
      actorRole: "administrator",
      actorName: "Meridian Traffic Control",
      action: "dataset.seed",
      entityType: "dataset_source",
      entityId: "synthetic-meridian",
      detail: {
        seed: cfg.seed,
        scenario: cfg.scenario,
        accidents: synthAccidents.length,
        segments: segments.length,
      },
    },
    {
      actorUserId: 1,
      actorRole: "administrator",
      actorName: "Meridian Traffic Control",
      action: "dataset.register",
      entityType: "dataset_source",
      entityId: "official-crash-registry",
      detail: { note: "Integration slot reserved; no records loaded." },
    },
    {
      actorUserId: 2,
      actorRole: "administrator",
      actorName: "A. Vasquez",
      action: "quality.duplicate_scan",
      entityType: "accidents",
      entityId: null,
      detail: {
        rule: "75 m / 6 h",
        duplicatesFlagged: Math.floor(synthAccidents.length * cfg.duplicateRate),
      },
    },
  ]);

  const result: SeedResult = {
    segments: segments.length,
    accidents: synthAccidents.length,
    environmental: envValues.length,
    traffic: trafficValues.length,
    attachments: attachmentValues.length,
    verifications: verificationValues.length,
    durationMs: Date.now() - t0,
  };
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioArg = args.find((a) => a.startsWith("--scenario="));
  const seedArg = args.find((a) => a.startsWith("--seed="));
  const countArg = args.find((a) => a.startsWith("--count="));
  const cfg: SyntheticConfig = {
    ...DEFAULT_CONFIG,
    scenario: (scenarioArg?.split("=")[1] as Scenario) ?? DEFAULT_CONFIG.scenario,
    seed: seedArg ? Number(seedArg.split("=")[1]) : DEFAULT_CONFIG.seed,
    accidentCount: countArg ? Number(countArg.split("=")[1]) : DEFAULT_CONFIG.accidentCount,
  };
  process.stdout.write(
    `[seed] scenario=${cfg.scenario} seed=${cfg.seed} count=${cfg.accidentCount}\n`,
  );
  const res = await seedDatabase(cfg);
  process.stdout.write(`[seed] complete in ${res.durationMs}ms ${JSON.stringify(res)}\n`);
  await pool.end();
}

if (require.main === module) {
  void main().catch((err) => {
    process.stderr.write(`[seed] failed: ${String(err)}\n`);
    process.exit(1);
  });
}
