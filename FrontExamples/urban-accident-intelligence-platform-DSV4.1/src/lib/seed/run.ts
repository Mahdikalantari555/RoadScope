/**
 * Idempotent dataset seeding. Generates the synthetic city, the road network,
 * environmental and traffic observations, register + citizen-report accident
 * records, and the demo user accounts.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accidentCategories,
  accidents,
  auditLogs,
  cityFeatures,
  datasetSources,
  environmentalObservations,
  intersections,
  roadSegments,
  severityLevels,
  trafficObservations,
  users,
} from "@/db/schema";
import { DEMO_ACCOUNTS, hashPassword } from "../password";
import { generateCity, CITY } from "./city";
import { CATEGORIES, CITIZEN_DATASET, generateAccidents, REGISTER_DATASET, SCENARIOS, SEVERITIES, type ScenarioKey } from "./generate";

export type SeedSummary = {
  datasetIds: Record<string, number>;
  accidents: number;
  segments: number;
  intersections: number;
  environment: number;
  traffic: number;
};

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function seedDatabase(options?: { scenario?: ScenarioKey; count?: number }): Promise<SeedSummary> {
  const scenario = options?.scenario ?? "mixed";
  const count = options?.count ?? 1800;
  const scenarioMeta = SCENARIOS.find((s) => s.key === scenario) ?? SCENARIOS[0];
  const city = generateCity();
  const generated = generateAccidents(city, scenario, count);

  const insertedDatasets = await db
    .insert(datasetSources)
    .values([
      { ...REGISTER_DATASET, scenario, seed: generated.metadata.seed },
      { ...CITIZEN_DATASET, scenario, seed: generated.metadata.seed },
      {
        slug: "vnt-network",
        name: "Vantia synthetic road network",
        kind: "synthetic",
        scenario,
        seed: generated.metadata.seed,
        description: `${scenarioMeta.label}: ${scenarioMeta.description}`,
        citation: "Urban Accident Intelligence synthetic generator v1.0 (2026).",
      },
    ])
    .returning({ id: datasetSources.id, slug: datasetSources.slug });
  const datasetIds = Object.fromEntries(insertedDatasets.map((d) => [d.slug, d.id]));
  const networkId = datasetIds["vnt-network"];

  await db.insert(accidentCategories).values(
    CATEGORIES.map((c) => ({
      code: c.code,
      label: c.label,
      color: c.color,
      description: `Synthetic category: ${c.label.toLowerCase()} events generated at network-aware locations.`,
    })),
  );
  await db.insert(severityLevels).values(
    SEVERITIES.map((s) => ({
      code: s.code,
      label: s.label,
      weight: s.weight,
      color: s.color,
      description: `Severity weight ${s.weight} used in severity-weighted risk indices.`,
    })),
  );

  const userIds = new Map<string, number>();
  const userRows = await db
    .insert(users)
    .values(
      DEMO_ACCOUNTS.map((account) => ({
        email: account.email,
        displayName: account.name,
        role: account.role,
        passwordHash: hashPassword(account.password),
        organization: account.role === "citizen" ? "Public reporter" : "Vantia Road Safety Unit",
      })),
    )
    .returning({ id: users.id, email: users.email });
  userRows.forEach((u) => userIds.set(u.email, u.id));
  const citizenId = userIds.get("citizen@vantia.example") ?? null;

  await db.insert(cityFeatures).values(
    city.features.map((f) => ({
      datasetId: networkId,
      kind: f.kind,
      name: f.name,
      geometry: f.geometry,
      properties: f.properties,
    })),
  );

  await db.insert(intersections).values(
    city.intersections.map((i) => ({
      id: i.id,
      datasetId: networkId,
      name: i.name,
      lat: i.lat,
      lng: i.lng,
      roadNames: i.roadNames,
      isSignalised: i.isSignalised,
      district: i.district,
    })),
  );

  for (const batch of chunks(city.segments, 200)) {
    await db.insert(roadSegments).values(
      batch.map((s) => ({
        id: s.id,
        datasetId: networkId,
        name: s.name,
        roadClass: s.roadClass,
        lanes: s.lanes,
        speedLimitKmh: s.speedLimitKmh,
        surface: s.surface,
        isLit: s.isLit,
        district: s.district,
        lengthM: s.lengthM,
        startLat: s.startLat,
        startLng: s.startLng,
        endLat: s.endLat,
        endLng: s.endLng,
        minLat: s.minLat,
        minLng: s.minLng,
        maxLat: s.maxLat,
        maxLng: s.maxLng,
        aadt: s.aadt,
        heavyVehiclePct: s.heavyVehiclePct,
        geometry: s.geometry,
      })),
    );
  }

  const allAccidents = generated.accidents;
  const idByPublicId = new Map<string, number>();
  for (const batch of chunks(allAccidents, 250)) {
    const rows = await db
      .insert(accidents)
      .values(
        batch.map((a) => ({
          publicId: a.publicId,
          datasetId: datasetIds[a.datasetSlug],
          reporterId: a.reporterRole === "citizen" ? citizenId : null,
          status: a.status,
          categoryCode: a.categoryCode,
          severityCode: a.severityCode,
          occurredAt: a.occurredAt,
          reportedAt: a.reportedAt,
          lat: a.lat,
          lng: a.lng,
          originalLat: a.originalLat,
          originalLng: a.originalLng,
          positionalUncertaintyM: a.positionalUncertaintyM,
          locationMethod: a.locationMethod,
          geom: a.geom,
          district: a.district,
          roadSegmentId: a.roadSegmentId,
          vehicles: a.vehicles,
          casualties: a.casualties,
          fatalities: a.fatalities,
          emergencyServices: a.emergencyServices,
          description: a.description,
          weather: a.weather,
          roadSurface: a.roadSurface,
          lighting: a.lighting,
          hour: a.hour,
          dow: a.dow,
          month: a.month,
          qualityFlags: a.qualityFlags,
          verifiedAt: a.status === "verified" ? a.reportedAt : null,
          verifiedBy: a.status === "verified" ? userIds.get("admin@vantia.example") ?? null : null,
        })),
      )
      .returning({ id: accidents.id, publicId: accidents.publicId });
    rows.forEach((r) => idByPublicId.set(r.publicId, r.id));
  }

  // second pass: resolve duplicate references
  for (const a of allAccidents) {
    if (a.duplicateOfIndex === null) continue;
    const target = allAccidents[a.duplicateOfIndex];
    const targetId = idByPublicId.get(target.publicId);
    await db.execute(
      sql`update ${accidents} set duplicate_of_id = ${targetId}, duplicate_score = ${a.duplicateScore ?? 0.8} where public_id = ${a.publicId}`,
    );
  }

  for (const batch of chunks(generated.environment, 200)) {
    await db.insert(environmentalObservations).values(
      batch.map((e) => ({
        datasetId: networkId,
        district: e.district,
        lat: e.lat,
        lng: e.lng,
        observedAt: e.observedAt,
        daypart: e.daypart,
        condition: e.condition,
        precipitationMm: e.precipitationMm,
        temperatureC: e.temperatureC,
        visibilityM: e.visibilityM,
        roadSurface: e.roadSurface,
        lighting: e.lighting,
      })),
    );
  }

  for (const batch of chunks(generated.traffic, 300)) {
    await db.insert(trafficObservations).values(
      batch.map((t) => ({
        datasetId: networkId,
        segmentId: t.segmentId,
        daypart: t.daypart,
        observedAt: t.observedAt,
        aadt: t.aadt,
        heavyVehiclePct: t.heavyVehiclePct,
      })),
    );
  }

  await db.insert(auditLogs).values([
    {
      actor: "system",
      action: "dataset.seeded",
      entityType: "dataset_source",
      entityId: "vnt-register",
      detail: { scenario, count: allAccidents.length, seed: generated.metadata.seed, city: CITY.name },
    },
  ]);

  return {
    datasetIds,
    accidents: allAccidents.length,
    segments: city.segments.length,
    intersections: city.intersections.length,
    environment: generated.environment.length,
    traffic: generated.traffic.length,
  };
}
