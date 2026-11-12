// Repository layer: persists and loads the simulation, network, and analysis data.
//
// We run a synthetic simulation on demand and cache the resulting network
// graph in memory for spatial statistics computations (the graph is small
// enough to hold in RAM for this demo).

import { db } from "@/db";
import {
  datasetSources,
  roadNodes,
  roadSegments,
  roadLixels,
  severityLevels,
  accidentCategories,
  accidents,
  spatialAnalysisJobs,
  spatialAnalysisResults,
  users,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  generateSyntheticDataset,
  DEFAULT_PARAMS,
  type SimulationParams,
  type GeneratedData,
} from "@/lib/simulation/generator";
import { lineToGeoJsonGeo, metricToLonLat } from "@/lib/spatial/crs";
import { RoadNetworkGraph } from "@/lib/spatial/network";

// ─── In-memory singletons for current simulation ───────────────────────────

let currentGraph: RoadNetworkGraph | null = null;
let currentGenerated: GeneratedData | null = null;
let currentDatasetId: number | null = null;

// Map segment database ids to graph edge ids (for event->lixel mapping)
const segmentDbIdToGraphEdgeId = new Map<number, number>();
const graphEdgeIdToSegmentDbId = new Map<number, number>();

export function getCurrentGraph(): RoadNetworkGraph {
  if (!currentGraph) throw new Error("No simulation loaded. Call seedSyntheticDataset first.");
  return currentGraph;
}
export function getCurrentGenerated(): GeneratedData {
  if (!currentGenerated) throw new Error("No simulation loaded.");
  return currentGenerated;
}
export function getCurrentDatasetId(): number {
  if (!currentDatasetId) throw new Error("No dataset loaded.");
  return currentDatasetId;
}

// ─── Seed reference tables ─────────────────────────────────────────────────

export async function seedReferenceData() {
  // Upsert severity levels
  const severities = [
    { code: "pdo", label: "Property Damage Only", epdoWeight: 1.0, color: "#fbbf24" },
    { code: "injury", label: "Injury", epdoWeight: 3.2, color: "#f97316" },
    { code: "severe", label: "Severe Injury", epdoWeight: 13.0, color: "#ef4444" },
    { code: "fatal", label: "Fatal", epdoWeight: 54.0, color: "#7f1d1d" },
  ];
  for (const s of severities) {
    const existing = await db.select().from(severityLevels).where(eq(severityLevels.code, s.code));
    if (existing.length === 0) {
      await db.insert(severityLevels).values(s);
    }
  }

  const categories = [
    { code: "vehicle", label: "Vehicle-Vehicle", isVehicle: true },
    { code: "pedestrian", label: "Pedestrian", isPedestrian: true },
    { code: "cyclist", label: "Cyclist", isCyclist: true },
    { code: "single", label: "Single Vehicle", isVehicle: true },
  ];
  for (const c of categories) {
    const existing = await db.select().from(accidentCategories).where(eq(accidentCategories.code, c.code));
    if (existing.length === 0) {
      await db.insert(accidentCategories).values(c);
    }
  }

  const systemUsers = [
    { username: "simulator", role: "simulation", displayName: "System Simulator" },
    { username: "steward", role: "steward", displayName: "Data Steward" },
    { username: "researcher", role: "researcher", displayName: "GIScience Researcher" },
    { username: "citizen_demo", role: "citizen", displayName: "Demo Citizen" },
  ];
  for (const u of systemUsers) {
    const existing = await db.select().from(users).where(eq(users.username, u.username));
    if (existing.length === 0) {
      await db.insert(users).values(u);
    }
  }
}

// ─── Generate & persist synthetic dataset ──────────────────────────────────

export async function seedSyntheticDataset(
  partialParams: Partial<SimulationParams> = {}
): Promise<{ datasetId: number; generated: GeneratedData; nodeCount: number; segmentCount: number; lixelCount: number; accidentCount: number }> {
  const params = { ...DEFAULT_PARAMS, ...partialParams };
  const generated = generateSyntheticDataset(params);
  currentGenerated = generated;

  // Build in-memory graph
  const graph = new RoadNetworkGraph();
  const nodeIntId = new Map<string, number>();
  let nextNodeInt = 1;
  for (const n of generated.nodes) {
    nodeIntId.set(n.nodeId, nextNodeInt);
    graph.addNode(nextNodeInt, n.x, n.y);
    nextNodeInt++;
  }
  let nextEdgeInt = 1;
  segmentDbIdToGraphEdgeId.clear();
  graphEdgeIdToSegmentDbId.clear();

  // Clear existing data
  await db.delete(spatialAnalysisResults);
  await db.delete(spatialAnalysisJobs);
  await db.delete(accidents);
  await db.delete(roadLixels);
  await db.delete(roadSegments);
  await db.delete(roadNodes);
  await db.delete(datasetSources);

  // Insert dataset source
  const [ds] = await db.insert(datasetSources).values({
    name: `Synthetic ${params.scenario} (seed ${params.seed})`,
    type: "synthetic_simulation",
    scenario: params.scenario,
    seed: params.seed,
    params: params as unknown as Record<string, unknown>,
  }).returning();
  const datasetId = ds.id;
  currentDatasetId = datasetId;

  // Insert nodes
  for (const n of generated.nodes) {
    await db.insert(roadNodes).values({
      datasetSourceId: datasetId,
      nodeId: n.nodeId,
      x: n.x,
      y: n.y,
      longitude: n.longitude,
      latitude: n.latitude,
      degree: n.degree,
      isIntersection: n.isIntersection,
      signalized: n.signalized,
    });
  }

  // Insert segments
  const segDbId = new Map<string, number>();
  for (const s of generated.segments) {
    const fromNode = await db.select({ id: roadNodes.id })
      .from(roadNodes)
      .where(eq(roadNodes.nodeId, s.fromNodeId))
      .limit(1);
    const toNode = await db.select({ id: roadNodes.id })
      .from(roadNodes)
      .where(eq(roadNodes.nodeId, s.toNodeId))
      .limit(1);

    const [inserted] = await db.insert(roadSegments).values({
      datasetSourceId: datasetId,
      segmentId: s.segmentId,
      fromNodeId: fromNode[0]?.id,
      toNodeId: toNode[0]?.id,
      geom: lineToGeoJsonGeo(s.polyline) as unknown as Record<string, unknown>,
      geographicGeom: lineToGeoJsonGeo(s.polyline) as unknown as Record<string, unknown>,
      lengthMeters: s.lengthMeters,
      roadClass: s.roadClass,
      hierarchyLevel: s.hierarchyLevel,
      speedLimit: s.speedLimit,
      laneCount: s.laneCount,
      aadt: s.aadt,
      sinuosity: s.sinuosity,
      lighting: s.lighting,
      pedestrianFacility: s.pedestrianFacility,
      oneway: s.oneway,
    }).returning({ id: roadSegments.id });
    segDbId.set(s.segmentId, inserted.id);

    graph.addEdge(
      nextEdgeInt,
      nodeIntId.get(s.fromNodeId)!,
      nodeIntId.get(s.toNodeId)!,
      s.polyline,
      { dbSegmentId: inserted.id, roadClass: s.roadClass, hierarchyLevel: s.hierarchyLevel, oneway: s.oneway }
    );
    segmentDbIdToGraphEdgeId.set(inserted.id, nextEdgeInt);
    graphEdgeIdToSegmentDbId.set(nextEdgeInt, inserted.id);
    nextEdgeInt++;
  }

  // Insert lixels
  const lixelDbId = new Map<string, number>();
  for (const l of generated.lixels) {
    const parentDbId = segDbId.get(l.parentSegmentId);
    const [ins] = await db.insert(roadLixels).values({
      datasetSourceId: datasetId,
      lixelId: l.lixelId,
      parentSegmentId: parentDbId,
      mStart: l.mStart,
      mEnd: l.mEnd,
      lengthMeters: l.lengthMeters,
      resolution: l.resolution,
      geom: lineToGeoJsonGeo(l.polyline) as unknown as Record<string, unknown>,
      geographicGeom: lineToGeoJsonGeo(l.polyline) as unknown as Record<string, unknown>,
      midpointX: l.midpointX,
      midpointY: l.midpointY,
      midpointLon: l.midpointLon,
      midpointLat: l.midpointLat,
      roadClass: l.roadClass,
      aadt: l.aadt,
      groundTruthLambda: l.groundTruthLambda,
    }).returning({ id: roadLixels.id });
    lixelDbId.set(l.lixelId, ins.id);
  }

  // Insert accidents. We perform simple map-matching during insertion.
  const severityMap = new Map<string, number>();
  const sevRows = await db.select().from(severityLevels);
  for (const r of sevRows) severityMap.set(r.code, r.id);
  const catMap = new Map<string, number>();
  const catRows = await db.select().from(accidentCategories);
  for (const r of catRows) catMap.set(r.code, r.id);

  for (let i = 0; i < generated.accidents.length; i++) {
    const a = generated.accidents[i];
    // Snap the raw point to graph edges for VGI noise demonstration
    const snap = graph.snapToEdge({ x: a.rawX, y: a.rawY });
    const snapSegDbId = graphEdgeIdToSegmentDbId.get(snap.edgeId) ?? null;
    // find lixel id
    let snapLixelDbId: number | null = null;
    if (snapSegDbId) {
      const [segRow] = await db.select({ segmentId: roadSegments.segmentId })
        .from(roadSegments).where(eq(roadSegments.id, snapSegDbId));
      if (segRow) {
        const parentSeg = generated.segments.find(s => s.segmentId === segRow.segmentId);
        if (parentSeg) {
          // which lixel covers offset?
          const cand = generated.lixels.find(l =>
            l.parentSegmentId === parentSeg.segmentId &&
            snap.offsetM >= l.mStart && snap.offsetM < l.mEnd);
          if (cand) snapLixelDbId = lixelDbId.get(cand.lixelId) ?? null;
        }
      }
    }
    // Compute credibility
    let credibility = 0.5;
    if (a.isFalseAlarm) credibility = 0.1;
    else credibility = Math.max(0.2, 1 - snap.distance / 100) - (a.reportingLagMinutes > 60 ? 0.15 : 0);
    credibility = Math.max(0, Math.min(1, credibility));

    // Determine status
    const status = a.isFalseAlarm ? "raw_vgi" : "synthetic_ground_truth";

    const snapGeo = a.isFalseAlarm
      ? { lon: a.rawLon, lat: a.rawLat }
      : metricToLonLat(snap.point.x, snap.point.y);

    await db.insert(accidents).values({
      datasetSourceId: datasetId,
      status,
      reporterId: 1,
      incidentTime: a.incidentTime,
      reportTime: a.reportTime,
      reportingLagMinutes: a.reportingLagMinutes,
      rawGeom: { type: "Point", coordinates: [a.rawX, a.rawY] },
      rawLon: a.rawLon,
      rawLat: a.rawLat,
      rawPositionalUncertaintyM: a.rawPositionalUncertaintyM,
      snappedGeom: a.isFalseAlarm ? null : { type: "Point", coordinates: [snap.point.x, snap.point.y] },
      snappedLon: a.isFalseAlarm ? null : snapGeo.lon,
      snappedLat: a.isFalseAlarm ? null : snapGeo.lat,
      snappedSegmentId: snapSegDbId,
      snappedLixelId: snapLixelDbId,
      snappedOffsetM: snap.offsetM,
      snapDistanceM: snap.distance,
      snapConfidence: Math.max(0, 1 - snap.distance / 80),
      severityId: severityMap.get(a.severityCode) ?? severityMap.get("pdo")!,
      categoryId: catMap.get(a.categoryCode) ?? catMap.get("vehicle")!,
      vehicleCount: a.vehicleCount,
      pedestrianCount: a.pedestrianCount,
      cyclistCount: a.cyclistCount,
      fatalities: a.fatalities,
      injuries: a.injuries,
      emergencyResponse: a.emergencyResponse,
      weather: a.weather,
      lightingCondition: a.lightingCondition,
      roadSurface: a.roadSurface,
      narrative: a.isFalseAlarm ? "Unconfirmed citizen report" : `Synthetic crash (${a.severityCode})`,
      witnessCount: a.witnessCount,
      credibilityScore: credibility,
      isFalseAlarm: a.isFalseAlarm,
      groundTruthIntensity: a.groundTruthIntensity,
      trueSegmentId: a.isFalseAlarm ? null : (segDbId.get(a.trueSegmentId) ?? null),
      trueOffsetM: a.isFalseAlarm ? null : a.trueOffsetM,
    });
  }

  currentGraph = graph;
  return {
    datasetId,
    generated,
    nodeCount: generated.nodes.length,
    segmentCount: generated.segments.length,
    lixelCount: generated.lixels.length,
    accidentCount: generated.accidents.length,
  };
}

// ─── Fetch helpers ─────────────────────────────────────────────────────────

export async function getDataset() {
  const ds = await db.select().from(datasetSources).orderBy(desc(datasetSources.id)).limit(1);
  return ds[0] ?? null;
}

export async function getNetworkGeoJson(): Promise<GeoJSON.FeatureCollection> {
  const segs = await db.select().from(roadSegments);
  const features: GeoJSON.Feature[] = segs.map(s => ({
    type: "Feature",
    properties: {
      id: s.id,
      segmentId: s.segmentId,
      roadClass: s.roadClass,
      hierarchyLevel: s.hierarchyLevel,
      lengthMeters: s.lengthMeters,
      speedLimit: s.speedLimit,
      lanes: s.laneCount,
      aadt: s.aadt,
      sinuosity: s.sinuosity,
    },
    geometry: s.geographicGeom as GeoJSON.LineString,
  }));
  return { type: "FeatureCollection", features };
}

export async function getNodesGeoJson(): Promise<GeoJSON.FeatureCollection> {
  const ns = await db.select().from(roadNodes);
  return {
    type: "FeatureCollection",
    features: ns.map(n => ({
      type: "Feature",
      properties: {
        id: n.id,
        nodeId: n.nodeId,
        degree: n.degree,
        signalized: n.signalized,
      },
      geometry: { type: "Point", coordinates: [n.longitude, n.latitude] } as GeoJSON.Point,
    })),
  };
}

export async function getAccidentsGeoJson(options: {
  statuses?: string[];
  severities?: string[];
} = {}): Promise<GeoJSON.FeatureCollection> {
  let query = db.select({
    id: accidents.id,
    uuid: accidents.uuid,
    status: accidents.status,
    incidentTime: accidents.incidentTime,
    reportTime: accidents.reportTime,
    lon: accidents.snappedLon,
    lat: accidents.snappedLat,
    rawLon: accidents.rawLon,
    rawLat: accidents.rawLat,
    snapDistance: accidents.snapDistanceM,
    confidence: accidents.snapConfidence,
    severityId: accidents.severityId,
    categoryId: accidents.categoryId,
    fatalities: accidents.fatalities,
    injuries: accidents.injuries,
    vehicleCount: accidents.vehicleCount,
    pedestrianCount: accidents.pedestrianCount,
    cyclistCount: accidents.cyclistCount,
    weather: accidents.weather,
    lightingCondition: accidents.lightingCondition,
    roadSurface: accidents.roadSurface,
    witnessCount: accidents.witnessCount,
    credibility: accidents.credibilityScore,
    isFalseAlarm: accidents.isFalseAlarm,
    narrative: accidents.narrative,
    emergencyResponse: accidents.emergencyResponse,
  }).from(accidents);
  const rows = await query;
  const sevRows = await db.select().from(severityLevels);
  const sevMap = new Map(sevRows.map(r => [r.id, r]));
  const catRows = await db.select().from(accidentCategories);
  const catMap = new Map(catRows.map(r => [r.id, r]));

  const filtered = rows.filter(r => {
    const sev = sevMap.get(r.severityId!);
    if (options.statuses && options.statuses.length > 0) {
      if (!options.statuses.includes(r.status!)) return false;
    }
    if (options.severities && options.severities.length > 0) {
      if (!sev || !options.severities.includes(sev.code)) return false;
    }
    return true;
  });
  return {
    type: "FeatureCollection",
    features: filtered.map(r => {
      const sev = sevMap.get(r.severityId!);
      const cat = catMap.get(r.categoryId!);
      const lon = r.lon ?? r.rawLon!;
      const lat = r.lat ?? r.rawLat!;
      return {
        type: "Feature",
        properties: {
          id: r.id,
          status: r.status,
          incidentTime: r.incidentTime,
          severityCode: sev?.code,
          severityLabel: sev?.label,
          severityColor: sev?.color,
          categoryCode: cat?.code,
          fatalities: r.fatalities,
          injuries: r.injuries,
          vehicleCount: r.vehicleCount,
          pedestrianCount: r.pedestrianCount,
          cyclistCount: r.cyclistCount,
          weather: r.weather,
          lighting: r.lightingCondition,
          roadSurface: r.roadSurface,
          witnessCount: r.witnessCount,
          credibility: r.credibility,
          isFalseAlarm: r.isFalseAlarm,
          snapDistance: r.snapDistance,
          emergencyResponse: r.emergencyResponse,
        },
        geometry: { type: "Point", coordinates: [lon, lat] } as GeoJSON.Point,
      };
    }),
  };
}

export async function getLixelsGeoJson(): Promise<GeoJSON.FeatureCollection> {
  const lix = await db.select().from(roadLixels);
  return {
    type: "FeatureCollection",
    features: lix.map(l => ({
      type: "Feature",
      properties: {
        id: l.id,
        lixelId: l.lixelId,
        parentSegmentId: l.parentSegmentId,
        lengthMeters: l.lengthMeters,
        roadClass: l.roadClass,
        aadt: l.aadt,
        groundTruthLambda: l.groundTruthLambda,
        midpointLon: l.midpointLon,
        midpointLat: l.midpointLat,
      },
      geometry: l.geographicGeom as GeoJSON.LineString,
    })),
  };
}
