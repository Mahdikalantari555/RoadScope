import { db } from "@/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { riskEstimates, spatialAnalysisJobs } from "@/db/schema";
import { requireDataset } from "@/lib/geo/datasetGraph";
import { fc, lineFeature, pointFeature, type Feature } from "@/lib/geojson";
import { bool, handleApiError, json, num, queryString } from "@/lib/api";
import { computeRisk } from "@/lib/analysis/methods";
import { DEFAULT_COMPOSITE_WEIGHTS } from "@/lib/stats/risk";
import { mean, round } from "@/lib/stats/common";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export type RiskMetric = "count" | "density" | "epdo" | "rate" | "eb" | "psi" | "composite" | "uncertainty";
const METRICS: RiskMetric[] = ["count", "density", "epdo", "rate", "eb", "psi", "composite", "uncertainty"];

/**
 * GET /api/datasets/:id/risk
 * Four-tier safety metrics + Empirical Bayes + composite + uncertainty layer.
 * Computes and persists on first request (or when `recompute=1`).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireDataset(id);
    const q = queryString(req.url);
    const level = q.get("level") === "lixel" ? "lixel" : "segment";
    const metric = (q.get("metric") ?? "eb") as RiskMetric;
    const recompute = bool(q, "recompute", false);
    const limit = Math.min(5000, num(q, "limit", 1200));

    let rows = await db
      .select()
      .from(riskEstimates)
      .where(and(eq(riskEstimates.datasetId, ctx.dataset.id), eq(riskEstimates.level, level)))
      .orderBy(desc(riskEstimates.compositeScore))
      .limit(20000);

    let computedNow = false;
    if (rows.length === 0 || recompute) {
      const risk = await computeRisk(ctx, { level, includeGroundTruth: false, includeUnverified: true, weightBy: "count" });
      computedNow = true;
      const values: (typeof riskEstimates.$inferInsert)[] = risk.rows.map((r) => ({
        datasetId: ctx.dataset.id,
        level,
        unitId: r.unit.unitId,
        segmentId: r.unit.segmentId,
        srid: ctx.crs.srid,
        x: level === "segment" ? (ctx.graph.segmentById.get(r.unit.unitId)?.x1 ?? 0) : (ctx.graph.lixels[ctx.graph.lixelIndexById.get(r.unit.unitId) ?? 0]?.x ?? 0),
        y: level === "segment" ? (ctx.graph.segmentById.get(r.unit.unitId)?.y1 ?? 0) : (ctx.graph.lixels[ctx.graph.lixelIndexById.get(r.unit.unitId) ?? 0]?.y ?? 0),
        gridKey: "0:0",
        lengthKm: r.unit.lengthKm,
        roadClass: r.unit.roadClass,
        crashCount: r.unit.crashCount,
        crashDensityPerKm: r.unit.crashDensityPerKm,
        epdo: r.unit.epdo,
        epdoPerKm: r.unit.epdoPerKm,
        exposureVkt: r.unit.vktPerWindow,
        crashRatePerMvkt: r.unit.crashRatePerMvkt,
        hasExposure: r.unit.hasExposure,
        spfExpected: r.eb.spfExpected,
        overdispersionPhi: r.eb.phi,
        ebWeight: r.eb.weight,
        ebEstimate: r.eb.estimate,
        ebLower95: r.eb.lower95,
        ebUpper95: r.eb.upper95,
        psi: r.eb.psi,
        excessCrashes: r.eb.excess,
        compositeScore: r.composite,
        compositeRank: r.rank,
        compositeWeights: { ...DEFAULT_COMPOSITE_WEIGHTS } as Record<string, number>,
        uncertainty: r.unc.total,
        uncertaintyComponents: r.unc.components,
        trueLambda: level === "lixel" ? (ctx.graph.lixels[ctx.graph.lixelIndexById.get(r.unit.unitId) ?? 0]?.trueLambda ?? null) : null,
        computedAt: new Date(),
      }));
      for (let i = 0; i < values.length; i += 250) {
        await db.insert(riskEstimates).values(values.slice(i, i + 250)).onConflictDoUpdate({
          target: [riskEstimates.datasetId, riskEstimates.level, riskEstimates.unitId],
          set: {
            crashCount: sql`excluded.crash_count`,
            crashDensityPerKm: sql`excluded.crash_density_per_km`,
            epdo: sql`excluded.epdo`,
            epdoPerKm: sql`excluded.epdo_per_km`,
            exposureVkt: sql`excluded.exposure_vkt`,
            crashRatePerMvkt: sql`excluded.crash_rate_per_mvkt`,
            hasExposure: sql`excluded.has_exposure`,
            spfExpected: sql`excluded.spf_expected`,
            overdispersionPhi: sql`excluded.overdispersion_phi`,
            ebWeight: sql`excluded.eb_weight`,
            ebEstimate: sql`excluded.eb_estimate`,
            ebLower95: sql`excluded.eb_lower95`,
            ebUpper95: sql`excluded.eb_upper95`,
            psi: sql`excluded.psi`,
            excessCrashes: sql`excluded.excess_crashes`,
            compositeScore: sql`excluded.composite_score`,
            compositeRank: sql`excluded.composite_rank`,
            uncertainty: sql`excluded.uncertainty`,
            uncertaintyComponents: sql`excluded.uncertainty_components`,
            computedAt: sql`excluded.computed_at`,
          },
        });
      }
      rows = await db
        .select()
        .from(riskEstimates)
        .where(and(eq(riskEstimates.datasetId, ctx.dataset.id), eq(riskEstimates.level, level)))
        .orderBy(desc(riskEstimates.compositeScore))
        .limit(20000);
    }

    const valueOf = (r: (typeof rows)[number]): number => {
      switch (metric) {
        case "count":
          return r.crashCount;
        case "density":
          return r.crashDensityPerKm;
        case "epdo":
          return r.epdoPerKm;
        case "rate":
          return r.crashRatePerMvkt ?? 0;
        case "eb":
          return r.ebEstimate ?? 0;
        case "psi":
          return r.psi ?? 0;
        case "composite":
          return r.compositeScore ?? 0;
        case "uncertainty":
          return r.uncertainty ?? 0;
      }
    };

    const sorted = rows.slice().sort((a, b) => valueOf(b) - valueOf(a));
    const features: Feature[] = sorted.slice(0, limit).map((r) => {
      const props = {
        unitId: r.unitId,
        level,
        roadClass: r.roadClass,
        metric,
        value: round(valueOf(r), 6),
        crashCount: r.crashCount,
        densityPerKm: r.crashDensityPerKm,
        epdo: r.epdo,
        epdoPerKm: r.epdoPerKm,
        ratePerMvkt: r.crashRatePerMvkt,
        hasExposure: r.hasExposure,
        exposureVkt: r.exposureVkt,
        spfExpected: r.spfExpected,
        ebWeight: r.ebWeight,
        ebEstimate: r.ebEstimate,
        ebLower95: r.ebLower95,
        ebUpper95: r.ebUpper95,
        psi: r.psi,
        excessCrashes: r.excessCrashes,
        compositeScore: r.compositeScore,
        compositeRank: r.compositeRank,
        uncertainty: r.uncertainty,
        uncertaintyComponents: r.uncertaintyComponents,
        trueLambda: r.trueLambda,
        name: ctx.graph.segmentById.get(r.segmentId)?.name ?? null,
        lengthKm: round(r.lengthKm, 5),
      };
      if (level === "segment") {
        const seg = ctx.graph.segmentById.get(r.unitId);
        return seg ? lineFeature(ctx.crs, seg.shape, props, r.unitId) : pointFeature(ctx.crs, r.x, r.y, props, r.unitId);
      }
      const li = ctx.graph.lixelIndexById.get(r.unitId);
      const lixel = li !== undefined ? ctx.graph.lixels[li] : null;
      if (!lixel) return pointFeature(ctx.crs, r.x, r.y, props, r.unitId);
      const seg = ctx.graph.segmentById.get(lixel.segmentId);
      if (!seg) return pointFeature(ctx.crs, lixel.x, lixel.y, props, r.unitId);
      const a = pointAlong(seg.shape, lixel.mStart);
      const b = pointAlong(seg.shape, lixel.mEnd);
      return lineFeature(ctx.crs, [[a.x, a.y], [b.x, b.y]], props, r.unitId);
    });

    const jobs = await db
      .select({ id: spatialAnalysisJobs.id, method: spatialAnalysisJobs.method, status: spatialAnalysisJobs.status, createdAt: spatialAnalysisJobs.createdAt })
      .from(spatialAnalysisJobs)
      .where(and(eq(spatialAnalysisJobs.datasetId, ctx.dataset.id)))
      .orderBy(desc(spatialAnalysisJobs.createdAt))
      .limit(5);

    const ranked = sorted.slice(0, 30).map((r, i) => ({
      rank: i + 1,
      unitId: r.unitId,
      name: ctx.graph.segmentById.get(r.segmentId)?.name ?? "—",
      roadClass: r.roadClass,
      lengthKm: round(r.lengthKm, 4),
      observed: r.crashCount,
      expected: r.spfExpected,
      eb: r.ebEstimate,
      ci95: [r.ebLower95, r.ebUpper95],
      ebWeight: r.ebWeight,
      excess: r.excessCrashes,
      psi: r.psi,
      densityPerKm: r.crashDensityPerKm,
      epdoPerKm: r.epdoPerKm,
      ratePerMvkt: r.crashRatePerMvkt,
      hasExposure: r.hasExposure,
      composite: r.compositeScore,
      uncertainty: r.uncertainty,
    }));

    return json({
      datasetId: ctx.dataset.id,
      level,
      metric,
      metrics: METRICS,
      computedNow,
      unitCount: rows.length,
      featureCount: features.length,
      geojson: fc(ctx.crs, features),
      rankedCorridors: ranked,
      summary: {
        totalObserved: round(rows.reduce((s, r) => s + r.crashCount, 0), 3),
        totalExpected: round(rows.reduce((s, r) => s + (r.spfExpected ?? 0), 0), 3),
        totalEb: round(rows.reduce((s, r) => s + (r.ebEstimate ?? 0), 0), 3),
        totalExcess: round(rows.reduce((s, r) => s + (r.excessCrashes ?? 0), 0), 3),
        meanEbWeight: round(mean(rows.map((r) => r.ebWeight ?? 0)), 4),
        exposureCoveragePct: round((rows.filter((r) => r.hasExposure).length / Math.max(1, rows.length)) * 100, 2),
        meanUncertainty: round(mean(rows.map((r) => r.uncertainty ?? 0)), 4),
        unitsWithZeroCount: rows.filter((r) => r.crashCount === 0).length,
        rtmCandidates: rows.filter((r) => (r.crashCount ?? 0) > 2 * Math.max(0.2, r.spfExpected ?? 0)).length,
      },
      disclaimer:
        "Composite scores are transparent weighted rank heuristics for prioritisation, not calibrated crash probabilities. EB estimates are posterior means under a Gamma–Poisson SPF prior and correct regression-to-the-mean; they are not forecasts.",
      recentJobs: jobs,
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
