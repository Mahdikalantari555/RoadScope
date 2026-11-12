import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  roadLixels,
  roadSegments,
  accidents,
  severityLevels,
  spatialAnalysisJobs,
} from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import {
  planarKde,
  networkKde,
  networkGetisOrd,
  networkDBSCAN,
  empiricalBayes,
  benchmark,
  type KernelType,
  type EventLocation,
  type LixelMidpoint,
} from "@/lib/spatial/stats";
import { getCurrentGraph, getCurrentGenerated } from "@/lib/db/repo";
import { lonLatToMetric } from "@/lib/spatial/crs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const t0 = Date.now();
  const body = await request.json().catch(() => ({}));
  const analysisType = body.type as string;
  const bandwidthM = body.bandwidth ?? 200;
  const kernel = (body.kernel ?? "gaussian") as KernelType;
  const minPts = body.minPts ?? 4;
  const epsM = body.eps ?? 150;
  const metric = body.metric ?? "frequency"; // frequency | density | epdo | eb

  const tStartJob = await db.insert(spatialAnalysisJobs).values({
    jobType: analysisType,
    params: body,
    status: "running",
  }).returning();
  const jobId = tStartJob[0].id;

  try {
    // Fetch lixels and segments
    const lixels = await db.select().from(roadLixels);
    const segments = await db.select().from(roadSegments);
    const sevRows = await db.select().from(severityLevels);
    const sevMap = new Map(sevRows.map(r => [r.id, r]));

    // Fetch verified accidents
    const accs = await db.select().from(accidents)
      .where(sql`${accidents.isFalseAlarm} = false OR ${accidents.isFalseAlarm} IS NULL`);

    // Build event locations: project each accident onto its snapped segment
    const graph = getCurrentGraph();

    const events: EventLocation[] = [];
    for (const a of accs) {
      if (a.isFalseAlarm) continue;
      const segDbId = a.snappedSegmentId;
      if (!segDbId) continue;
      // find graph edge id
      const segRow = segments.find(s => s.id === segDbId);
      if (!segRow) continue;
      // We need graph edge id — look up by matching segment id via graph edges' dbSegmentId
      const edge = graph.edges.find(e => e.dbSegmentId === segDbId);
      if (!edge) continue;
      const offset = a.snappedOffsetM ?? 0;
      // Weight by severity EPDO if metric === epdo
      const sev = sevMap.get(a.severityId!);
      let weight = 1;
      if (metric === "epdo" && sev) weight = sev.epdoWeight;
      const sx = a.snappedLon ? lonLatToMetric(a.snappedLon, a.snappedLat!).x : 0;
      const sy = a.snappedLat ? lonLatToMetric(a.snappedLon!, a.snappedLat).y : 0;
      events.push({
        eventId: a.id,
        edgeId: edge.id,
        offsetM: offset,
        weight,
        x: sx,
        y: sy,
      });
    }

    // Build lixel midpoints with edge mapping
    const lixelMidpoints: LixelMidpoint[] = [];
    const lixelIdxToDbId = new Map<number, number>();
    for (let i = 0; i < lixels.length; i++) {
      const lix = lixels[i];
      const parentSegDbId = lix.parentSegmentId;
      if (!parentSegDbId) continue;
      const edge = graph.edges.find(e => e.dbSegmentId === parentSegDbId);
      if (!edge) continue;
      const mStart = lix.mStart;
      const mEnd = lix.mEnd;
      const mMid = (mStart + mEnd) / 2;
      lixelMidpoints.push({
        lixelId: lix.id,
        edgeId: edge.id,
        offsetM: mMid,
        x: lix.midpointX,
        y: lix.midpointY,
        lengthM: lix.lengthMeters,
      });
      lixelIdxToDbId.set(i, lix.id);
    }

    let result: Record<string, unknown> = {};

    if (analysisType === "nkde" || analysisType === "compare_kde") {
      const tNet = Date.now();
      const { density: nkde } = networkKde(events, lixelMidpoints, bandwidthM, graph, kernel);
      const networkRuntime = Date.now() - tNet;
      result = { ...result, nkde, networkRuntime };

      if (analysisType === "compare_kde") {
        // Planar KDE on event points (use snapped lon/lat converted to metric)
        const planarPts = events.map(e => ({ x: e.x, y: e.y }));
        const samplePts = lixelMidpoints.map(l => ({ x: l.x, y: l.y }));
        const weights = events.map(e => e.weight);
        const pkde = planarKde(planarPts, samplePts, bandwidthM, kernel, weights);
        const diff = nkde.map((v, i) => v - pkde[i]);
        result = { ...result, pkde, diff };
      }
    }

    if (analysisType === "planar_kde") {
      const planarPts = events.map(e => ({ x: e.x, y: e.y }));
      const samplePts = lixelMidpoints.map(l => ({ x: l.x, y: l.y }));
      const pkde = planarKde(planarPts, samplePts, bandwidthM, kernel, events.map(e => e.weight));
      result = { ...result, pkde };
    }

    if (analysisType === "getis_ord") {
      // Use raw crash count per lixel as the variable of interest
      const counts = new Array(lixelMidpoints.length).fill(0);
      for (const ev of events) {
        // Find which lixel midpoint is closest along the same edge, or use spatial lookup
        let bestIdx = -1;
        let bestD = Infinity;
        for (let i = 0; i < lixelMidpoints.length; i++) {
          const lm = lixelMidpoints[i];
          if (lm.edgeId !== ev.edgeId) continue;
          const d = Math.abs(lm.offsetM - ev.offsetM);
          if (d < bestD) { bestD = d; bestIdx = i; }
        }
        if (bestIdx >= 0) counts[bestIdx] += ev.weight;
      }
      const go = networkGetisOrd(counts, lixelMidpoints, bandwidthM, graph, 199, true);
      result = { ...result, counts, ...go };
    }

    if (analysisType === "ndbscan") {
      const ndb = networkDBSCAN(events, epsM, minPts, graph);
      // Map labels to per-event and build cluster summaries
      const clusterEvents: Record<number, Array<{ eventId: number; x: number; y: number }>> = {};
      for (let i = 0; i < events.length; i++) {
        const cl = ndb.labels[i];
        if (cl < 0) continue;
        if (!clusterEvents[cl]) clusterEvents[cl] = [];
        // convert metric to lonlat
        const { lon, lat } = await import("@/lib/spatial/crs").then(m => m.metricToLonLat(events[i].x, events[i].y));
        clusterEvents[cl].push({ eventId: events[i].eventId, x: lon, y: lat });
      }
      // For each cluster, compute a simple bounding convex hull (as a polygon of lon/lat points)
      const clusterSummary = Object.entries(clusterEvents).map(([clId, evts]) => {
        const lons = evts.map(e => e.x);
        const lats = evts.map(e => e.y);
        const minLon = Math.min(...lons), maxLon = Math.max(...lons);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        return {
          clusterId: +clId,
          size: evts.length,
          hull: {
            type: "Polygon",
            coordinates: [[
              [minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat], [minLon, minLat]
            ]] as [number, number][][],
          },
        };
      });
      result = {
        labels: ndb.labels,
        clusterCount: ndb.clusterCount,
        clusterSizes: ndb.clusterSizes,
        clusters: clusterSummary,
        eventCount: events.length,
      };
    }

    if (analysisType === "eb_risk") {
      // Aggregate observed counts per parent segment
      const segCounts = new Map<number, number>();
      for (const ev of events) {
        const seg = segments.find(s => s.id === graph.edges.find(e => e.id === ev.edgeId)?.dbSegmentId);
        if (!seg) continue;
        segCounts.set(seg.id, (segCounts.get(seg.id) ?? 0) + ev.weight);
      }
      const ebResults: Array<{
        segmentId: number;
        observed: number;
        spfExpected: number;
        ebEstimate: number;
        psi: number;
        weight: number;
        rawRatePerMvk: number;
      }> = [];
      for (const seg of segments) {
        const observed = segCounts.get(seg.id) ?? 0;
        const eb = empiricalBayes({
          segmentLengthKm: seg.lengthMeters / 1000,
          observedCount: observed,
          aadt: seg.aadt ?? 5000,
          roadClass: seg.roadClass ?? "residential",
        });
        // crashes per million vehicle km travelled
        const mvkt = (seg.aadt ?? 5000) * 365 * (seg.lengthMeters / 1000) / 1_000_000;
        const rawRate = mvkt > 0 ? observed / mvkt : 0;
        ebResults.push({
          segmentId: seg.id,
          observed,
          spfExpected: eb.spfExpected,
          ebEstimate: eb.ebEstimate,
          psi: eb.psi,
          weight: eb.weight,
          rawRatePerMvk: rawRate,
        });
      }
      result = { ebResults };
    }

    if (analysisType === "benchmark") {
      // Compare estimated (from NKDE) to ground truth lambda across lixels
      const { density: nkde } = networkKde(events, lixelMidpoints, bandwidthM, graph, kernel);
      const gt = lixels.map(l => l.groundTruthLambda ?? 0);
      // Normalize both to [0,1] for comparability
      const maxN = Math.max(...nkde, 1e-9);
      const maxG = Math.max(...gt, 1e-9);
      const est = nkde.map(v => v / maxN);
      const truth = gt.map(v => v / maxG);
      const metrics = benchmark(est, truth, 0.10);
      // Also compute at multiple thresholds
      const metricsAt5 = benchmark(est, truth, 0.05);
      const metricsAt20 = benchmark(est, truth, 0.20);
      result = { metrics, metricsAt5, metricsAt20, eventCount: events.length, bandwidthM };
    }

    const runtime = Date.now() - t0;
    await db.update(spatialAnalysisJobs).set({
      status: "completed",
      completedAt: new Date(),
      runtimeMs: runtime,
      metadata: { eventCount: events.length, lixelCount: lixels.length },
    }).where(eq(spatialAnalysisJobs.id, jobId));

    // Attach lixel metadata for mapping
    const lixelMeta = lixels.map(l => ({
      id: l.id,
      lon: l.midpointLon,
      lat: l.midpointLat,
      roadClass: l.roadClass,
      groundTruthLambda: l.groundTruthLambda,
      coordinates: (l.geographicGeom as GeoJSON.LineString).coordinates,
    }));

    return NextResponse.json({
      ok: true,
      runtimeMs: runtime,
      eventCount: events.length,
      lixelCount: lixels.length,
      bandwidthM,
      kernel,
      lixelMeta,
      ...result,
    });
  } catch (err) {
    console.error("analyze error:", err);
    await db.update(spatialAnalysisJobs).set({
      status: "failed",
      errorMessage: (err as Error).message,
    }).where(eq(spatialAnalysisJobs.id, jobId));
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
