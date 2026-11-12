import { NextResponse } from "next/server";
import { db } from "@/db";
import { accidents, severityLevels, accidentCategories, users } from "@/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { getCurrentGraph } from "@/lib/db/repo";
import { lonLatToMetric, metricToLonLat } from "@/lib/spatial/crs";
import { networkDistanceBetweenEdgePoints } from "@/lib/spatial/network";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      longitude,
      latitude,
      incidentTime,
      reportTime,
      positionalUncertaintyM = 30,
      severityCode = "pdo",
      categoryCode = "vehicle",
      vehicleCount = 1,
      pedestrianCount = 0,
      cyclistCount = 0,
      fatalities = 0,
      injuries = 0,
      emergencyResponse = false,
      weather = "clear",
      lightingCondition = "daylight",
      roadSurface = "dry",
      narrative = "",
    } = body;

    if (typeof longitude !== "number" || typeof latitude !== "number") {
      return NextResponse.json({ ok: false, error: "longitude/latitude required" }, { status: 400 });
    }

    // Ensure citizen user exists
    let citizen = await db.select().from(users).where(eq(users.username, "citizen_demo")).limit(1);
    if (citizen.length === 0) {
      const [ins] = await db.insert(users).values({
        username: "citizen_demo",
        role: "citizen",
        displayName: "Demo Citizen",
      }).returning();
      citizen = [ins];
    }
    const reporterId = citizen[0].id;

    const sev = await db.select().from(severityLevels).where(eq(severityLevels.code, severityCode)).limit(1);
    const cat = await db.select().from(accidentCategories).where(eq(accidentCategories.code, categoryCode)).limit(1);

    // Convert to metric CRS
    const { x: rawX, y: rawY } = lonLatToMetric(longitude, latitude);

    // Snap to graph
    const graph = getCurrentGraph();
    const snap = graph.snapToEdge({ x: rawX, y: rawY });
    const snapGeo = metricToLonLat(snap.point.x, snap.point.y);

    // Look up snapped segment/lixel by dbSegmentId
    // Find road segment where graph edge dbSegmentId matches
    const snapEdge = graph.edges.find(e => e.id === snap.edgeId);
    const snappedSegmentId = snapEdge?.dbSegmentId ?? null;

    let snappedLixelId: number | null = null;
    if (snappedSegmentId) {
      const { roadLixels: rl } = await import("@/db/schema");
      const lixRow = await db.select().from(rl)
        .where(and(
          eq(rl.parentSegmentId, snappedSegmentId),
          sql`${rl.mStart} <= ${snap.offsetM} AND ${rl.mEnd} > ${snap.offsetM}`
        ))
        .limit(1);
      if (lixRow.length > 0) snappedLixelId = lixRow[0].id;
    }

    const confidence = Math.max(0, 1 - snap.distance / 80);

    // Check for nearby recent reports (conflation suggestion) within 200m network and 30 minutes
    const recentReports = await db.select({
      id: accidents.id,
      snappedSegmentId: accidents.snappedSegmentId,
      snappedOffsetM: accidents.snappedOffsetM,
      incidentTime: accidents.incidentTime,
      status: accidents.status,
      witnessCount: accidents.witnessCount,
      credibility: accidents.credibilityScore,
    }).from(accidents)
      .where(sql`incident_time >= NOW() - INTERVAL '7 days' AND status != 'rejected'`)
      .limit(100);

    const suggestions: Array<{
      id: number;
      networkDistanceM: number;
      timeDiffMin: number;
      combinedScore: number;
    }> = [];

    for (const r of recentReports) {
      if (!r.snappedSegmentId || r.snappedOffsetM == null) continue;
      const rEdge = graph.edges.find(e => e.dbSegmentId === r.snappedSegmentId);
      if (!rEdge) continue;
      const a = { edgeId: snap.edgeId, offsetM: snap.offsetM };
      const b = { edgeId: rEdge.id, offsetM: r.snappedOffsetM };
      let netD = 0;
      if (a.edgeId === b.edgeId) {
        netD = Math.abs(a.offsetM - b.offsetM);
      } else {
        netD = networkDistanceBetweenEdgePoints(graph, a, b);
      }
      if (!isFinite(netD) || netD > 300) continue;
      const tDiff = Math.abs((new Date(incidentTime || Date.now()).getTime() - new Date(r.incidentTime!).getTime()) / 60000);
      if (tDiff > 120) continue;
      // Combined score: closer in space and time = better candidate to merge
      const score = 1 - (netD / 300) * 0.6 - (tDiff / 120) * 0.4;
      if (score > 0.3) {
        suggestions.push({
          id: r.id,
          networkDistanceM: +netD.toFixed(1),
          timeDiffMin: +tDiff.toFixed(1),
          combinedScore: +score.toFixed(3),
        });
      }
    }
    suggestions.sort((a, b) => b.combinedScore - a.combinedScore);

    // Determine if this should be treated as a corroboration or new report.
    // For the demo, always create a new report with witnessCount 1 and flag near duplicates.
    const [inserted] = await db.insert(accidents).values({
      datasetSourceId: 1,
      status: "raw_vgi",
      reporterId,
      incidentTime: incidentTime ? new Date(incidentTime) : new Date(),
      reportTime: reportTime ? new Date(reportTime) : new Date(),
      reportingLagMinutes: incidentTime ? (Date.now() - new Date(incidentTime).getTime()) / 60000 : 0,
      rawGeom: { type: "Point", coordinates: [rawX, rawY] },
      rawLon: longitude,
      rawLat: latitude,
      rawPositionalUncertaintyM: positionalUncertaintyM,
      snappedGeom: { type: "Point", coordinates: [snap.point.x, snap.point.y] },
      snappedLon: snapGeo.lon,
      snappedLat: snapGeo.lat,
      snappedSegmentId,
      snappedLixelId,
      snappedOffsetM: snap.offsetM,
      snapDistanceM: snap.distance,
      snapConfidence: confidence,
      severityId: sev[0]?.id,
      categoryId: cat[0]?.id,
      vehicleCount,
      pedestrianCount,
      cyclistCount,
      fatalities,
      injuries,
      emergencyResponse,
      weather,
      lightingCondition,
      roadSurface,
      narrative,
      witnessCount: 1,
      credibilityScore: confidence * 0.8,
    }).returning({ id: accidents.id });

    return NextResponse.json({
      ok: true,
      id: inserted.id,
      snap: {
        distanceM: +snap.distance.toFixed(2),
        confidence: +confidence.toFixed(3),
        snappedLon: snapGeo.lon,
        snappedLat: snapGeo.lat,
      },
      nearbyDuplicates: suggestions.slice(0, 5),
      suggestion: suggestions.length > 0
        ? `${suggestions.length} nearby existing report(s) found. Consider corroborating instead.`
        : "No nearby duplicates detected. New report created.",
    });
  } catch (err) {
    console.error("report error:", err);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
