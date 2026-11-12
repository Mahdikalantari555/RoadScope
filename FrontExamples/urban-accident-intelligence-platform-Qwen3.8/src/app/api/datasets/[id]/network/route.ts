import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { roadNodes, roadSegments } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { fc, lineFeature, pointFeature, round6, type Feature } from "@/lib/geojson";
import { bool, handleApiError, json, queryString } from "@/lib/api";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/datasets/:id/network
 * Serialises the road topology (and optionally the lixel LRS lattice) to
 * GeoJSON in EPSG:4326 — the only place where metric geometry is reprojected.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireDataset(id);
    const q = queryString(req.url);
    const includeNodes = bool(q, "nodes", true);
    const includeLixels = bool(q, "lixels", false);

    const features: Feature[] = ctx.graph.segments.map((s) =>
      lineFeature(
        ctx.crs,
        s.shape,
        {
          kind: "segment",
          segmentId: s.id,
          name: s.name,
          roadClass: s.roadClass,
          classOrdinal: s.classOrdinal,
          lanes: s.lanes,
          speedLimitKph: s.speedLimitKph,
          aadt: s.aadt,
          hasExposure: s.aadt !== null,
          sinuosity: round6(s.sinuosity),
          lengthM: Math.round(s.lengthM * s.sinuosity * 100) / 100,
          lighting: s.lighting,
          surface: s.surface,
          isBridge: s.isBridge,
          cycleLane: s.cycleLane,
          vktPerDay: s.vktPerDay,
        },
        s.id,
      ),
    );

    if (includeNodes) {
      const nodes = await db.select().from(roadNodes).where(and(eq(roadNodes.datasetId, ctx.dataset.id)));
      for (const n of nodes) {
        features.push(
          pointFeature(
            ctx.crs,
            n.x,
            n.y,
            { kind: "node", nodeId: n.id, degree: n.degree, control: n.control, nodeType: n.nodeType, gradeSeparated: n.isGradeSeparated },
            n.id,
          ),
        );
      }
    }

    if (includeLixels) {
      ctx.graph.lixels.forEach((l) => {
        const seg = ctx.graph.segmentById.get(l.segmentId);
        if (!seg) return;
        const a = l.mStart;
        const b = l.mEnd;
        const p1 = pointAlong(seg.shape, a);
        const p2 = pointAlong(seg.shape, b);
        features.push(
          lineFeature(
            ctx.crs,
            [
              [p1.x, p1.y],
              [p2.x, p2.y],
            ],
            {
              kind: "lixel",
              lixelId: l.id,
              segmentId: l.segmentId,
              lrsIndex: l.lrsIndex,
              mStart: round6(l.mStart),
              mEnd: round6(l.mEnd),
              lengthM: round6(l.lengthM),
              roadClass: l.roadClass,
              aadt: l.aadt,
              distToNodeM: round6(l.distToNodeM),
            },
            l.id,
          ),
        );
      });
    }

    const [stats] = await db
      .select({
        segments: sql<number>`count(*)::int`,
        length: sql<number>`coalesce(sum(curvilinear_length_m),0)`,
      })
      .from(roadSegments)
      .where(eq(roadSegments.datasetId, ctx.dataset.id));

    return json({
      dataset: {
        id: ctx.dataset.id,
        name: ctx.dataset.name,
        kind: ctx.dataset.kind,
        scenario: ctx.dataset.scenario,
        synthetic: ctx.dataset.kind === "synthetic",
        srid: ctx.dataset.srid,
        crsName: ctx.dataset.crsName,
        lixelLengthM: ctx.dataset.lixelLengthM,
        seed: ctx.dataset.seed,
        networkStats: ctx.dataset.networkStats,
      },
      geojson: fc(ctx.crs, features),
      counts: { segments: stats?.segments ?? ctx.graph.segments.length, lixels: ctx.graph.lixels.length, nodes: ctx.graph.nodes.length, totalLengthM: stats?.length ?? 0 },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

function pointAlong(shape: Array<[number, number]>, m: number) {
  let remaining = Math.max(0, m);
  for (let i = 1; i < shape.length; i++) {
    const ax = shape[i - 1][0];
    const ay = shape[i - 1][1];
    const bx = shape[i][0];
    const by = shape[i][1];
    const seg = Math.hypot(bx - ax, by - ay);
    if (remaining <= seg || i === shape.length - 1) {
      const t = seg === 0 ? 0 : Math.min(1, remaining / seg);
      return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t };
    }
    remaining -= seg;
  }
  return { x: shape[shape.length - 1][0], y: shape[shape.length - 1][1] };
}
