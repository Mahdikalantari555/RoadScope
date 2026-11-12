/**
 * The geocomputation engine: every analytical method used by the Spatial
 * Analysis Laboratory, the Risk workbench and the Benchmarking evaluator.
 * Methods are pure functions of (dataset graph, persisted parameters) and emit
 * GeoJSON only at the serialisation boundary.
 */
import { db } from "@/db";
import { eq, and, sql } from "drizzle-orm";
import { accidents, roadLixels, riskEstimates } from "@/db/schema";
import type { DatasetContext } from "@/lib/geo/datasetGraph";
import { fc, lineFeature, pointFeature, polygonFeature, type Feature } from "@/lib/geojson";
import { pointAtM, type RoadGraph } from "@/lib/geo/graph";
import { loadIncidents, type AnalysisFilters } from "@/lib/analysis/data";
import type { AnalysisParams, Method, MethodPayload } from "@/lib/analysis/types";
import { DEFAULT_NKDE, nkde, planarKde, compareSurfaces, type WeightedPoint } from "@/lib/stats/nkde";
import { buildNetworkWeights, localGetisOrd, localMoran } from "@/lib/stats/getisord";
import { nDbScan } from "@/lib/stats/ndbscan";
import {
  DEFAULT_COMPOSITE_WEIGHTS,
  aggregateUnits,
  compositeScore,
  empiricalBayes,
  fitSpf,
  spfPredict,
  uncertainty,
  type UnitAggregates,
} from "@/lib/stats/risk";
import { evaluateAgainstGroundTruth } from "@/lib/stats/benchmark";
import { buildTimeBins, diurnalMatrix, mean, pearson, round, spearman } from "@/lib/stats/common";
import { bboxFromGeoJson } from "@/lib/geojson";
import { epdoWeight } from "@/lib/domain/taxonomy";

export type ProgressFn = (progress: number, stage: string) => Promise<void> | void;

const noop: ProgressFn = () => undefined;

function filtersFrom(params: AnalysisParams, ctx: DatasetContext): AnalysisFilters {
  const f: AnalysisFilters = {
    includeGroundTruth: params.includeGroundTruth ?? false,
    includeUnverified: params.includeUnverified ?? true,
    statuses: params.statuses,
    severities: params.severities,
    categories: params.categories,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    weightBy: params.weightBy ?? "count",
    credibilityFloor: params.credibilityFloor ?? 0,
  };
  if (params.bbox && params.bbox.length === 4) f.bboxMetric = bboxFromGeoJson(ctx.crs, params.bbox);
  return f;
}

function lixelGeometry(graph: RoadGraph, index: number): Array<[number, number]> {
  const l = graph.lixels[index];
  const seg = graph.segmentById.get(l.segmentId);
  if (!seg) return [[l.x, l.y]];
  const a = pointAtM(seg.shape, l.mStart);
  const b = pointAtM(seg.shape, l.mEnd);
  return [[a.x, a.y], [b.x, b.y]];
}

async function groundTruthArrays(ctx: DatasetContext): Promise<{ lambda: number[]; realized: number[]; available: boolean }> {
  const n = ctx.graph.lixels.length;
  const lambda = new Array<number>(n).fill(0);
  let available = true;
  ctx.graph.lixels.forEach((l, i) => {
    if (l.trueLambda === null || l.trueLambda === undefined) available = false;
    lambda[i] = l.trueLambda ?? 0;
  });
  const realized = new Array<number>(n).fill(0);
  const rows = await db
    .select({ lixelId: accidents.lixelId, c: sql<number>`count(*)::int` })
    .from(accidents)
    .where(and(eq(accidents.datasetId, ctx.dataset.id), eq(accidents.isGroundTruth, true)))
    .groupBy(accidents.lixelId);
  for (const r of rows) {
    if (!r.lixelId) continue;
    const idx = ctx.graph.lixelIndexById.get(r.lixelId);
    if (idx !== undefined) realized[idx] = r.c;
  }
  return { lambda, realized, available };
}

export async function runMethod(
  ctx: DatasetContext,
  method: Method,
  params: AnalysisParams,
  onProgress: ProgressFn = noop,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  const filters = filtersFrom(params, ctx);
  await onProgress(0.05, "loading_incidents");
  const incidents = await loadIncidents(ctx, filters);
  const studyDays = (ctx.dataset.simParams as any)?.process?.studyDays ?? 365;

  switch (method) {
    case "nkde":
    case "planar_kde":
    case "nkde_planar_diff":
      return densityMethod(ctx, method, params, incidents, onProgress, filters);
    case "network_getis_ord":
    case "network_moran":
      return autocorrelationMethod(ctx, method, params, incidents, onProgress, studyDays);
    case "n_dbscan":
      return clusteringMethod(ctx, params, incidents, onProgress);
    case "lixel_aggregation":
      return aggregationMethod(ctx, params, incidents, onProgress, studyDays);
    case "covariate_cross_comparison":
      return covariateMethod(ctx, params, incidents, onProgress, studyDays);
    case "eb_smoothing":
      return ebMethod(ctx, params, incidents, onProgress, studyDays);
    case "composite_vulnerability":
      return compositeMethod(ctx, params, incidents, onProgress, studyDays);
    case "ground_truth_benchmark":
      return benchmarkMethod(ctx, params, incidents, onProgress, studyDays);
    default:
      throw new Error(`unsupported_method:${method}`);
  }
}

/* ------------------------------------------------------------------ */
/* NKDE / planar KDE / difference                                      */
/* ------------------------------------------------------------------ */

async function densityMethod(
  ctx: DatasetContext,
  method: Method,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  filters: AnalysisFilters,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  const points: WeightedPoint[] = incidents.records.map((r, i) => ({
    lixelIndex: r.lixelIndex,
    x: incidents.clusterPoints[i].x,
    y: incidents.clusterPoints[i].y,
    weight: r.weight,
  }));

  const nkdeParams = {
    bandwidthM: params.bandwidthM ?? DEFAULT_NKDE.bandwidthM,
    kernel: params.kernel ?? DEFAULT_NKDE.kernel,
    edgeCorrection: params.edgeCorrection ?? true,
    splitting: params.splitting ?? true,
  };
  await onProgress(0.2, "computing_network_kernel");
  const net = nkde(graph, points, nkdeParams);
  await onProgress(0.55, "computing_planar_reference");
  const pla = planarKde(graph, points, { bandwidthM: params.planarBandwidthM ?? nkdeParams.bandwidthM, kernel: nkdeParams.kernel });
  const comparison = compareSurfaces(graph, net.values, pla.values);
  await onProgress(0.7, "assembling_features");

  const gt = await groundTruthArrays(ctx);
  const showPlanar = method === "planar_kde";
  const showDiff = method === "nkde_planar_diff";
  const primary = showPlanar ? pla.values : showDiff ? comparison.difference : net.values;

  const features: Feature[] = graph.lixels.map((l, i) =>
    Object.assign(
      lineFeature(ctx.crs, lixelGeometry(graph, i), {
        lixelId: l.id,
        segmentId: l.segmentId,
        roadClass: l.roadClass,
        lrsIndex: l.lrsIndex,
        mMid: round(l.mMid, 2),
        value: round(primary[i], 8),
        nkdePerKm: round(net.values[i], 6),
        planarPerM2: round(pla.values[i], 12),
        difference: round(comparison.difference[i], 6),
        trueLambdaPerKm: l.trueLambda !== null ? round((l.trueLambda / (l.lengthM / 1000)) * (365 / studyDaysOf(ctx)), 4) : null,
        realizedCount: gt.realized[i],
      }, l.id),
      {},
    ),
  );

  let benchmark: Record<string, unknown> | null = null;
  if (gt.available) {
    await onProgress(0.85, "benchmarking_against_ground_truth");
    const predictedPerLixel = Array.from(showPlanar ? pla.values : net.values).map((v, i) => v * (graph.lixels[i].lengthM / 1000));
    const scale = sumOf(predictedPerLixel) > 0 ? sumOf(gt.lambda) / sumOf(predictedPerLixel) : 1;
    benchmark = evaluateAgainstGroundTruth({
      predicted: predictedPerLixel.map((v) => v * scale),
      trueLambda: gt.lambda,
      realizedCounts: gt.realized,
      label: method,
    }) as unknown as Record<string, unknown>;
  }

  const studyDays = studyDaysOf(ctx);
  return {
    features: fc(ctx.crs, features),
    stats: {
      method,
      bandwidthM: nkdeParams.bandwidthM,
      kernel: nkdeParams.kernel,
      edgeCorrection: nkdeParams.edgeCorrection,
      okabeSplitting: nkdeParams.splitting,
      incidentsUsed: incidents.count,
      totalWeight: round(incidents.totalWeight, 4),
      lixelCount: graph.lixels.length,
      lixelLengthM: ctx.dataset.lixelLengthM,
      nkde: { unit: net.unit, mean: round(net.mean, 6), max: round(net.max, 6), nonZero: net.nonZero, runtimeMs: net.runtimeMs },
      planar: { unit: pla.unit, mean: round(pla.mean, 12), max: round(pla.max, 12), nonZero: pla.nonZero, runtimeMs: pla.runtimeMs },
      comparison: comparison.stats,
      studyDays,
      filters,
    },
    benchmark,
    formulation: {
      title: showPlanar ? "Planar (Euclidean) KDE" : showDiff ? "NKDE − Planar KDE difference" : "Network-Constrained KDE (NKDE)",
      latex: showPlanar
        ? "\\hat f_{\\mathrm{pla}}(u)=\\sum_j w_j\\,K\\!\\left(\\frac{\\lVert u-v_j\\rVert}{h}\\right)\\big/h^{2}"
        : showDiff
          ? "\\Delta(u)=\\tilde f_{\\mathrm{pla}}(u)-\\tilde\\lambda_{\\mathrm{net}}(u),\\quad \\tilde{\\cdot}=\\cdot/\\max(\\cdot)"
          : "\\hat\\lambda_{\\mathrm{net}}(u)=\\frac{1}{c(u)}\\sum_j w_j\\,K\\!\\left(\\frac{d_N(u,v_j)}{h}\\right)\\frac{1}{h}\\prod_{v\\in V(p_{uj})}\\frac{1}{\\deg(v)-1}",
      notes: [
        showPlanar
          ? "Planar KDE ignores topology; it is retained only as the bias reference required by US-4.1."
          : "d_N is the shortest-path distance on the lixel-centre graph — never Euclidean.",
        "The product over vertices implements Okabe's equal-splitting (discontinuous) NKDE, preventing artificial mass accumulation at intersections.",
        `c(u) = Σ_k L_k K(d_N(u,k)/h)/h is the approximate boundary correction (edgeCorrection=${nkdeParams.edgeCorrection}).`,
        "Kernel support is truncated at 3h (Gaussian) or h (Epanechnikov/Quartic/Triangular/Uniform).",
        `Synthetic dataset: results benchmarked against the simulator's oracle λ (PAI/RRI/RMSE).`,
      ],
    },
    sampleSize: incidents.count,
    unitCount: graph.lixels.length,
  };
}

function studyDaysOf(ctx: DatasetContext): number {
  return (ctx.dataset.simParams as any)?.process?.studyDays ?? 365;
}

function sumOf(v: number[]): number {
  return v.reduce((a, b) => a + b, 0);
}

/* ------------------------------------------------------------------ */
/* Network Getis-Ord / Moran                                           */
/* ------------------------------------------------------------------ */

async function autocorrelationMethod(
  ctx: DatasetContext,
  method: Method,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  studyDays: number,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  const level = params.level ?? "lixel";
  await onProgress(0.15, "aggregating_units");
  const units = aggregateUnits(graph, incidents.records, level, studyDays);
  const x = units.map((u) => (params.weightBy === "epdo" ? u.epdo : u.crashCount));

  await onProgress(0.3, "building_network_weights");
  const weightMode = params.weightMode ?? "distance_decay";
  const bandwidthM = params.bandwidthM ?? 300;
  const k = params.contiguityK ?? 2;
  const weights =
    level === "lixel"
      ? buildNetworkWeights(graph, { mode: weightMode, bandwidthM, k, includeSelf: true })
      : buildNetworkWeights(graph, { mode: "distance_decay", bandwidthM, k, includeSelf: true });

  await onProgress(0.45, "permutation_inference");
  const permutations = Math.min(1999, params.permutations ?? 999);
  const gi = localGetisOrd(graph, x, weights, {
    permutations,
    alpha: params.alpha ?? 0.05,
    seed: params.seed ?? 42,
    weightMode,
    bandwidthM,
    k,
  });

  const moran = method === "network_moran" ? localMoran(graph, x, weights, Math.min(permutations, 499), params.seed ?? 7) : null;
  await onProgress(0.85, "assembling_features");

  const features: Feature[] = units.map((u, i) => {
    const idx = level === "lixel" ? u.lixelIndices[0] : (graph.lixelsBySegment.get(u.unitId)?.[0] ?? -1);
    const geom = level === "lixel" ? lixelGeometry(graph, idx) : (graph.segmentById.get(u.unitId)?.shape ?? []);
    const cls = !gi.significant05[i] ? "not_significant" : gi.z[i] > 0 ? (gi.significant01[i] ? "hotspot_p01" : "hotspot_p05") : gi.significant01[i] ? "coldspot_p01" : "coldspot_p05";
    return lineFeature(
      ctx.crs,
      geom,
      {
        unitId: u.unitId,
        level,
        roadClass: u.roadClass,
        crashCount: u.crashCount,
        epdo: u.epdo,
        densityPerKm: u.crashDensityPerKm,
        giStarZ: round(gi.z[i], 5),
        pRaw: gi.pRaw[i],
        qValue: round(gi.qValue[i], 6),
        significanceClass: cls,
        fdrRejected: gi.fdrRejected[i],
        localMoranI: moran ? round(moran.Ii[i], 6) : null,
        lisaQuadrant: moran ? moran.quadrants[i] : null,
        neighbourCount: weights[i]?.count ?? 0,
      },
      u.unitId,
    );
  });

  const gt = await groundTruthArrays(ctx);
  let benchmark: Record<string, unknown> | null = null;
  if (gt.available && level === "lixel") {
    const predicted = gi.z.map((z, i) => Math.max(0, z) * (units[i]?.crashCount ?? 0) + Math.max(0, units[i]?.crashCount ?? 0) * 0.001);
    benchmark = evaluateAgainstGroundTruth({
      predicted,
      trueLambda: gt.lambda,
      realizedCounts: gt.realized,
      label: `${method}_hotspot_mask`,
    }) as unknown as Record<string, unknown>;
  }

  return {
    features: fc(ctx.crs, features),
    stats: {
      method,
      level,
      weightMode,
      bandwidthM,
      contiguityK: k,
      permutations: gi.permutationsUsed,
      candidateCount: gi.candidateCount,
      alpha: params.alpha ?? 0.05,
      n: gi.n,
      meanNeighbours: gi.meanNeighbours,
      globalMoranI: gi.globalMoranI,
      globalMoranZ: gi.globalMoranZ,
      globalMoranP: gi.globalMoranP,
      expectedI: round(-1 / Math.max(1, gi.n - 1), 6),
      hotspots: gi.hotspots,
      coldspots: gi.coldspots,
      fdrRejected: gi.fdrRejected.filter(Boolean).length,
      assumptions: gi.assumptions,
      runtimeMs: gi.runtimeMs,
      lisaQuadrantCounts: moran
        ? moran.quadrants.reduce<Record<string, number>>((acc, q) => ({ ...acc, [q]: (acc[q] ?? 0) + 1 }), {})
        : undefined,
      filters: { weightBy: params.weightBy, includeUnverified: params.includeUnverified },
    },
    benchmark,
    formulation: {
      title: method === "network_moran" ? "Network-constrained Local Moran's Iᵢ (LISA)" : "Network-constrained Getis-Ord Gᵢ*",
      latex:
        method === "network_moran"
          ? "I_i=\\frac{x_i-\\bar x}{m_2}\\sum_{j} w^{\\mathrm{net}}_{ij}\\,(x_j-\\bar x)"
          : "G_i^{*}=\\frac{\\sum_j w^{\\mathrm{net}}_{ij}x_j-\\bar X\\sum_j w^{\\mathrm{net}}_{ij}}{S\\sqrt{\\frac{n\\sum_j (w^{\\mathrm{net}}_{ij})^2-(\\sum_j w^{\\mathrm{net}}_{ij})^2}{n-1}}}",
      notes: [
        `W_net built with ${weightMode === "contiguity" ? `k=${k}-order edge contiguity across shared intersection nodes` : `shortest-path decay w=exp(-d_N/h), h=${bandwidthM} m`}.`,
        `Pseudo p-values from ${gi.permutationsUsed} global randomisations of x over the salient candidate set (|Z| ≥ cutoff), then Benjamini–Hochberg FDR at α=${params.alpha ?? 0.05}.`,
        `Global Moran's I = ${gi.globalMoranI} (E[I] = ${round(-1 / Math.max(1, gi.n - 1), 5)}, Z = ${gi.globalMoranZ}, permutation p = ${gi.globalMoranP}).`,
        "Descriptive density (NKDE) and statistical significance are rendered as separate layers: high density ≠ significant cluster.",
        "Assumption checks are executed before inference; see stats.assumptions.",
      ],
    },
    sampleSize: incidents.count,
    unitCount: units.length,
  };
}

/* ------------------------------------------------------------------ */
/* N-DBSCAN                                                            */
/* ------------------------------------------------------------------ */

async function clusteringMethod(
  ctx: DatasetContext,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  const epsilonM = params.epsilonM ?? 220;
  const minPoints = params.minPoints ?? 4;
  await onProgress(0.35, "network_neighbourhood_queries");
  const result = nDbScan(graph, incidents.clusterPoints, { epsilonM, minPoints, weighted: true });
  await onProgress(0.8, "hulls_and_subgraphs");

  const features: Feature[] = [];
  for (const c of result.clusters) {
    features.push(
      polygonFeature(
        ctx.crs,
        c.hull,
        {
          kind: "cluster_hull",
          clusterId: c.clusterId,
          size: c.size,
          weight: c.weight,
          dominantSeverity: c.dominantSeverity,
          networkSpanM: c.networkSpanM,
          planarSpanM: c.planarSpanM,
          spanRatio: c.spanRatio,
          segments: c.segments.length,
        },
        `hull-${c.clusterId}`,
      ),
    );
    for (const segId of c.segments) {
      const seg = graph.segmentById.get(segId);
      if (seg) features.push(lineFeature(ctx.crs, seg.shape, { kind: "cluster_subgraph", clusterId: c.clusterId, segmentId: seg.id, roadClass: seg.roadClass }, `sub-${c.clusterId}-${seg.id}`));
    }
    for (const id of c.memberIds) {
      const idx = incidents.clusterPoints.findIndex((p) => p.id === id);
      if (idx >= 0) {
        const p = incidents.clusterPoints[idx];
        features.push(pointFeature(ctx.crs, p.x, p.y, { kind: "cluster_member", clusterId: c.clusterId, severityCode: p.severityCode, weight: p.weight }, id));
      }
    }
  }
  for (const id of result.noiseIds.slice(0, 4000)) {
    const p = incidents.clusterPoints.find((q) => q.id === id);
    if (p) features.push(pointFeature(ctx.crs, p.x, p.y, { kind: "noise", severityCode: p.severityCode }, id));
  }

  return {
    features: fc(ctx.crs, features),
    stats: {
      method: "n_dbscan",
      epsilonM,
      minPoints,
      clusterCount: result.clusters.length,
      noiseCount: result.noiseCount,
      coreCount: result.coreCount,
      clusteredShare: round(1 - result.noiseCount / Math.max(1, incidents.clusterPoints.length), 4),
      meanSpanRatio: round(mean(result.clusters.map((c) => c.spanRatio)), 4),
      largestCluster: result.clusters[0]?.size ?? 0,
      clusters: result.clusters.slice(0, 40).map((c) => ({
        clusterId: c.clusterId,
        size: c.size,
        weight: c.weight,
        dominantSeverity: c.dominantSeverity,
        networkSpanM: c.networkSpanM,
        planarSpanM: c.planarSpanM,
        spanRatio: c.spanRatio,
        segments: c.segments.length,
        firstOccurrence: new Date(c.firstOccurrence).toISOString(),
        lastOccurrence: new Date(c.lastOccurrence).toISOString(),
      })),
      runtimeMs: result.runtimeMs,
    },
    benchmark: null,
    formulation: {
      title: "Network DBSCAN (N-DBSCAN)",
      latex: "N_\\varepsilon^{\\mathrm{net}}(p)=\\{q\\in D : d_N(p,q)\\le\\varepsilon\\},\\quad p\\ \\text{core} \\iff |N_\\varepsilon^{\\mathrm{net}}(p)|\\ge MinPts",
      notes: [
        `ε-neighbourhoods are obtained by truncated Dijkstra on the lixel-centre graph (ε=${epsilonM} m, MinPts=${minPoints}).`,
        "spanRatio = network span / planar span quantifies topological distortion inside each cluster; ratios ≫ 1 indicate clusters that are Euclidean-compact but network-elongated.",
        "Noise points are emitted separately so that micro-scale clusters are never conflated with background incidence.",
      ],
    },
    sampleSize: incidents.clusterPoints.length,
    unitCount: result.clusters.length,
  };
}

/* ------------------------------------------------------------------ */
/* Aggregation + covariate cross-comparison                            */
/* ------------------------------------------------------------------ */

async function aggregationMethod(
  ctx: DatasetContext,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  studyDays: number,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  const level = params.level ?? "lixel";
  await onProgress(0.3, "aggregating");
  const units = aggregateUnits(graph, incidents.records, level, studyDays);
  const binUnit = params.timeBin ?? "week";
  const bins = buildTimeBins(incidents.timeRange.min || Date.now() - studyDays * 86400e3, incidents.timeRange.max || Date.now(), binUnit);
  const series = bins.map((b) => ({ key: b.key, label: b.label, start: new Date(b.startMs).toISOString(), end: new Date(b.endMs).toISOString(), count: 0, epdo: 0, verified: 0 }));
  const binIndex = new Map(bins.map((b, i) => [b.key, i]));
  const matrix = diurnalMatrix(incidents.clusterPoints.map((p) => p.occurredAt), incidents.clusterPoints.map((p) => p.weight));
  for (let i = 0; i < incidents.clusterPoints.length; i++) {
    const p = incidents.clusterPoints[i];
    const d = new Date(p.occurredAt);
    const key = d.toISOString().slice(0, binUnit === "hour" ? 13 : 10);
    let idx = binIndex.get(key);
    if (idx === undefined && binUnit === "week") {
      idx = Math.floor((p.occurredAt - (incidents.timeRange.min || p.occurredAt)) / (7 * 86400e3));
    }
    if (idx !== undefined && series[idx]) {
      series[idx].count += p.weight;
      series[idx].epdo += incidents.records[i]?.epdo ?? 1;
      if (incidents.records[i]?.isVerified) series[idx].verified += 1;
    }
  }

  await onProgress(0.75, "assembling_features");
  const features: Feature[] = units.map((u) => {
    const geom = level === "lixel" ? lixelGeometry(graph, u.lixelIndices[0]) : (graph.segmentById.get(u.unitId)?.shape ?? []);
    return lineFeature(
      ctx.crs,
      geom,
      {
        unitId: u.unitId,
        level,
        roadClass: u.roadClass,
        lengthKm: round(u.lengthKm, 5),
        crashCount: u.crashCount,
        densityPerKm: u.crashDensityPerKm,
        epdo: u.epdo,
        epdoPerKm: u.epdoPerKm,
        ratePerMvkt: u.crashRatePerMvkt,
        hasExposure: u.hasExposure,
        aadt: u.aadt,
        verifiedCount: u.verifiedCount,
        vgiOnlyCount: u.vgiOnlyCount,
      },
      u.unitId,
    );
  });

  const severityMix: Record<string, number> = {};
  for (const p of incidents.clusterPoints) severityMix[p.severityCode] = (severityMix[p.severityCode] ?? 0) + p.weight;

  return {
    features: fc(ctx.crs, features),
    stats: {
      method: "lixel_aggregation",
      level,
      timeBin: binUnit,
      series,
      diurnalMatrix: matrix.map((row) => row.map((v) => round(v, 3))),
      severityMix: Object.fromEntries(Object.entries(severityMix).map(([k, v]) => [k, round(v, 3)])),
      unitCount: units.length,
      incidentsUsed: incidents.count,
      totalEpdo: round(incidents.totalEpdo, 3),
      zeroShare: round(units.filter((u) => u.crashCount === 0).length / Math.max(1, units.length), 4),
    },
    benchmark: null,
    formulation: {
      title: "Spatiotemporal lixel aggregation",
      latex: "N_u=\\sum_{i\\in u} w_i,\\quad D_u=N_u/L_u,\\quad \\mathrm{EPDO}_u=\\sum_k \\omega_k N_{u,k}",
      notes: [
        `Uniform lixels (L=${ctx.dataset.lixelLengthM} m) remove segment-length MAUP bias from every rate.`,
        "Temporal bins are UTC; the diurnal matrix is 7×24 with Monday as row 0.",
        "Weights follow the selected weighting scheme (count / EPDO / credibility / severity rank).",
      ],
    },
    sampleSize: incidents.count,
    unitCount: units.length,
  };
}

async function covariateMethod(
  ctx: DatasetContext,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  studyDays: number,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  await onProgress(0.3, "aggregating_lixels");
  const units = aggregateUnits(graph, incidents.records, "lixel", studyDays);
  const density = units.map((u) => u.crashDensityPerKm);
  const covariates: Record<string, number[]> = {
    speedLimitKph: graph.lixels.map((l) => l.speedLimitKph),
    lanes: graph.lixels.map((l) => l.lanes),
    aadt: graph.lixels.map((l) => l.aadt ?? 0),
    distToNodeM: graph.lixels.map((l) => l.distToNodeM),
    sinuosity: graph.lixels.map((l) => graph.segmentById.get(l.segmentId)?.sinuosity ?? 1),
    curvaturePerKm: graph.lixels.map((l) => graph.segmentById.get(l.segmentId)?.curvaturePerKm ?? 0),
    unlit: graph.lixels.map((l) => ((graph.segmentById.get(l.segmentId)?.lighting ?? "lit") === "unlit" ? 1 : 0)),
    intersectionDegree: graph.lixels.map((l) => {
      const seg = graph.segmentById.get(l.segmentId);
      if (!seg) return 0;
      const near = l.distToNodeM < 40 ? graph.nodeById.get(l.mMid < seg.lengthM / 2 ? seg.fromNodeId : seg.toNodeId) : null;
      return near?.degree ?? 0;
    }),
    classOrdinal: graph.lixels.map((l) => l.classOrdinal),
    trueLambda: graph.lixels.map((l) => l.trueLambda ?? 0),
  };
  await onProgress(0.7, "correlations");
  const correlations = Object.entries(covariates).map(([name, v]) => ({
    covariate: name,
    pearson: round(pearson(density, v), 5),
    spearman: round(spearman(density, v), 5),
    mean: round(mean(v), 4),
    nonZeroShare: round(v.filter((x) => x !== 0).length / Math.max(1, v.length), 4),
  }));

  const binned: Record<string, Array<{ bin: string; n: number; meanDensity: number; meanCovariate: number }>> = {};
  for (const [name, v] of Object.entries(covariates)) {
    if (name === "trueLambda") continue;
    const sorted = v.slice().sort((a, b) => a - b);
    const q = [0, 0.2, 0.4, 0.6, 0.8, 1].map((p) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]);
    const buckets = Array.from({ length: 5 }, () => ({ n: 0, sumD: 0, sumC: 0, lo: 0, hi: 0 }));
    for (let i = 0; i < v.length; i++) {
      let b = 4;
      for (let k = 0; k < 5; k++) if (v[i] <= q[k + 1] || k === 4) { b = k; break; }
      buckets[b].n++;
      buckets[b].sumD += density[i];
      buckets[b].sumC += v[i];
      buckets[b].lo = q[b];
      buckets[b].hi = q[b + 1];
    }
    binned[name] = buckets
      .filter((b) => b.n > 0)
      .map((b) => ({ bin: `${round(b.lo, 2)}–${round(b.hi, 2)}`, n: b.n, meanDensity: round(b.sumD / b.n, 4), meanCovariate: round(b.sumC / b.n, 3) }));
  }

  return {
    features: null,
    stats: {
      method: "covariate_cross_comparison",
      covariate: params.covariate ?? "all",
      correlations,
      binned,
      unitCount: units.length,
      incidentsUsed: incidents.count,
      note: "Correlations are descriptive associations over uniform lixels; they are not causal effects and are not exposure-adjusted.",
    },
    benchmark: null,
    formulation: {
      title: "Covariate cross-comparison",
      latex: "\\rho_s = 1-\\frac{6\\sum d_i^2}{n(n^2-1)},\\quad r=\\frac{\\sum (x_i-\\bar x)(y_i-\\bar y)}{\\sqrt{\\sum(x_i-\\bar x)^2\\sum(y_i-\\bar y)^2}}",
      notes: [
        "Quintile binning of each covariate against linear crash density exposes non-linear exposure relationships without a fitted model.",
        "trueLambda is included for synthetic datasets so that the empirical association can be compared with the generator's structural coefficients.",
      ],
    },
    sampleSize: incidents.count,
    unitCount: units.length,
  };
}

/* ------------------------------------------------------------------ */
/* Empirical Bayes + composite vulnerability                           */
/* ------------------------------------------------------------------ */

export interface RiskComputation {
  units: UnitAggregates[];
  fit: ReturnType<typeof fitSpf>;
  rows: Array<{
    unit: UnitAggregates;
    eb: ReturnType<typeof empiricalBayes>;
    unc: ReturnType<typeof uncertainty>;
    composite: number;
    rank: number;
  }>;
  studyDays: number;
}

export async function computeRisk(ctx: DatasetContext, params: AnalysisParams, onProgress: ProgressFn = noop): Promise<RiskComputation> {
  const graph = ctx.graph;
  const level = params.level ?? "segment";
  const studyDays = studyDaysOf(ctx);
  const filters = filtersFrom(params, ctx);
  await onProgress(0.1, "loading_incidents");
  const incidents = await loadIncidents(ctx, filters);
  await onProgress(0.3, "aggregating_units");
  const units = aggregateUnits(graph, incidents.records, level, studyDays);
  await onProgress(0.5, "fitting_spf");
  const fit = fitSpf(units);
  const phi = fit.fit?.phi ?? 1.5;

  const compositeInputs = units.map((u) => {
    const seg = graph.segmentById.get(u.segmentId);
    return {
      ebEstimate: 0,
      epdoPerKm: u.epdoPerKm,
      curvaturePerKm: seg?.curvaturePerKm ?? 0,
      sinuosity: seg?.sinuosity ?? 1,
      speedLimitKph: seg?.speedLimitKph ?? 50,
      lanes: seg?.lanes ?? 2,
      unlitShare: (seg?.lighting ?? "lit") === "unlit" ? 1 : 0,
      wetShare: 0.22,
      exposureGapPenalty: u.hasExposure ? 0 : 1,
    };
  });

  await onProgress(0.7, "empirical_bayes");
  const ebRows = units.map((u) => {
    const mu = fit.fit ? spfPredict(u, fit.fit) : Math.max(1e-6, u.lengthKm * 4);
    const eb = empiricalBayes(u.crashCount, mu, phi);
    compositeInputs[units.indexOf(u)].ebEstimate = eb.estimate;
    return { u, mu, eb };
  });

  const weights = { ...DEFAULT_COMPOSITE_WEIGHTS, ...(params.compositeWeights ?? {}) };
  await onProgress(0.85, "composite_scoring");
  const { scores } = compositeScore(compositeInputs, weights);
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  const rankOf = new Array<number>(scores.length).fill(0);
  order.forEach((o, r) => {
    rankOf[o.i] = r + 1;
  });

  const rows = units.map((u, i) => ({
    unit: u,
    eb: ebRows[i].eb,
    unc: uncertainty(u, ebRows[i].eb, ctx.dataset.lixelLengthM),
    composite: scores[i],
    rank: rankOf[i],
  }));

  return { units, fit, rows, studyDays };
}

async function persistRisk(ctx: DatasetContext, level: "lixel" | "segment", rows: RiskComputation["rows"], weights: Record<string, number>): Promise<number> {
  const values = rows.map((r) => ({
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
    compositeWeights: weights,
    uncertainty: r.unc.total,
    uncertaintyComponents: r.unc.components,
    trueLambda: level === "lixel" ? (ctx.graph.lixels[ctx.graph.lixelIndexById.get(r.unit.unitId) ?? 0]?.trueLambda ?? null) : null,
    computedAt: new Date(),
  }));
  for (let i = 0; i < values.length; i += 250) {
    await db
      .insert(riskEstimates)
      .values(values.slice(i, i + 250))
      .onConflictDoUpdate({
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
          compositeWeights: sql`excluded.composite_weights`,
          uncertainty: sql`excluded.uncertainty`,
          uncertaintyComponents: sql`excluded.uncertainty_components`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
  return values.length;
}

async function ebMethod(
  ctx: DatasetContext,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  _studyDays: number,
): Promise<MethodPayload> {
  const risk = await computeRisk(ctx, params, onProgress);
  const level = params.level ?? "segment";
  await onProgress(0.9, "persisting_risk_estimates");
  const persisted = params.persist === false ? 0 : await persistRisk(ctx, level, risk.rows, { phi: risk.fit.fit?.phi ?? 0 });

  const features: Feature[] = risk.rows.map((r) => {
    const geom = level === "lixel" ? lixelGeometry(ctx.graph, ctx.graph.lixelIndexById.get(r.unit.unitId) ?? 0) : (ctx.graph.segmentById.get(r.unit.unitId)?.shape ?? []);
    return lineFeature(
      ctx.crs,
      geom,
      {
        unitId: r.unit.unitId,
        level,
        roadClass: r.unit.roadClass,
        lengthKm: round(r.unit.lengthKm, 5),
        crashCount: r.unit.crashCount,
        densityPerKm: r.unit.crashDensityPerKm,
        epdo: r.unit.epdo,
        ratePerMvkt: r.unit.crashRatePerMvkt,
        hasExposure: r.unit.hasExposure,
        spfExpected: r.eb.spfExpected,
        ebWeight: r.eb.weight,
        ebEstimate: r.eb.estimate,
        ebLower95: r.eb.lower95,
        ebUpper95: r.eb.upper95,
        excess: r.eb.excess,
        psi: r.eb.psi,
        uncertainty: r.unc.total,
        uncertaintyComponents: r.unc.components,
        compositeScore: r.composite,
        compositeRank: r.rank,
      },
      r.unit.unitId,
    );
  });

  const gt = await groundTruthArrays(ctx);
  let benchmark: Record<string, unknown> | null = null;
  if (gt.available && level === "lixel") {
    benchmark = evaluateAgainstGroundTruth({
      predicted: risk.rows.map((r) => r.eb.estimate),
      trueLambda: gt.lambda,
      realizedCounts: gt.realized,
      label: "eb_estimate",
    }) as unknown as Record<string, unknown>;
  }

  return {
    features: fc(ctx.crs, features),
    stats: {
      method: "eb_smoothing",
      level,
      spf: risk.fit.fit,
      spfExcludedUnits: risk.fit.excluded,
      overdispersionPhi: risk.fit.fit?.phi ?? null,
      unitCount: risk.rows.length,
      incidentsUsed: incidents.count,
      persistedRows: persisted,
      topByExcess: risk.rows
        .slice()
        .sort((a, b) => b.eb.excess - a.eb.excess)
        .slice(0, 25)
        .map((r) => ({ unitId: r.unit.unitId, roadClass: r.unit.roadClass, observed: r.unit.crashCount, expected: r.eb.spfExpected, eb: r.eb.estimate, excess: r.eb.excess, psi: r.eb.psi, ci: [r.eb.lower95, r.eb.upper95], uncertainty: r.unc.total })),
      disclaimer: "EB estimates shrink short-term counts toward a class-level SPF prior; they are not calibrated probabilities of a future crash.",
    },
    benchmark,
    formulation: {
      title: "Empirical Bayes expected crash estimate (RTM correction)",
      latex: "E_i=w_iN_i+(1-w_i)\\mu_i,\\quad w_i=\\frac{\\varphi}{\\varphi+\\mu_i},\\quad \\mu_i=\\exp(\\beta_0+\\beta_1\\ln \\mathrm{VKT}_i+\\beta_2\\ln L_i+\\gamma_{c(i)})",
      notes: [
        "SPF fitted by Poisson quasi-likelihood IRLS on units with observed exposure; units lacking AADT receive a class-level prior and are flagged as an epistemic gap.",
        "Overdispersion φ from the method-of-moments Pearson dispersion statistic; w_i is the shrinkage weight (φ/(φ+μ)).",
        "95 % credible interval from the Gamma(φ+N, 1/(φ+μ)) posterior using a Wilson–Hilferty quantile approximation (documented approximation).",
        "PSI_i = (N_i − E_i)/N_i; excess E_i^exc = N_i − E_i ranks corridors by expected safety improvement.",
        "Regression-to-the-mean is controlled because a one-year spike with low exposure receives a small w_i and is pulled toward the prior.",
      ],
    },
    sampleSize: incidents.count,
    unitCount: risk.rows.length,
  };
}

async function compositeMethod(
  ctx: DatasetContext,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  studyDays: number,
): Promise<MethodPayload> {
  const risk = await computeRisk(ctx, params, onProgress);
  const level = params.level ?? "segment";
  const weights = { ...DEFAULT_COMPOSITE_WEIGHTS, ...(params.compositeWeights ?? {}) };
  await onProgress(0.9, "persisting");
  const persisted = params.persist === false ? 0 : await persistRisk(ctx, level, risk.rows, weights);
  const ranked = risk.rows.slice().sort((a, b) => a.rank - b.rank);
  const features: Feature[] = ranked.map((r) => {
    const geom = level === "lixel" ? lixelGeometry(ctx.graph, ctx.graph.lixelIndexById.get(r.unit.unitId) ?? 0) : (ctx.graph.segmentById.get(r.unit.unitId)?.shape ?? []);
    return lineFeature(
      ctx.crs,
      geom,
      {
        unitId: r.unit.unitId,
        level,
        roadClass: r.unit.roadClass,
        compositeScore: round(r.composite, 6),
        compositeRank: r.rank,
        ebEstimate: r.eb.estimate,
        epdoPerKm: r.unit.epdoPerKm,
        uncertainty: r.unc.total,
        name: ctx.graph.segmentById.get(r.unit.segmentId)?.name ?? null,
      },
      r.unit.unitId,
    );
  });
  return {
    features: fc(ctx.crs, features),
    stats: {
      method: "composite_vulnerability",
      level,
      weights,
      persistedRows: persisted,
      incidentsUsed: incidents.count,
      studyDays,
      rankedCorridors: ranked.slice(0, 40).map((r) => ({
        rank: r.rank,
        unitId: r.unit.unitId,
        name: ctx.graph.segmentById.get(r.unit.segmentId)?.name ?? "—",
        roadClass: r.unit.roadClass,
        lengthKm: round(r.unit.lengthKm, 4),
        observed: r.unit.crashCount,
        eb: r.eb.estimate,
        excess: r.eb.excess,
        psi: r.eb.psi,
        epdoPerKm: r.unit.epdoPerKm,
        composite: round(r.composite, 5),
        uncertainty: r.unc.total,
        hasExposure: r.unit.hasExposure,
      })),
      disclaimer:
        "The composite is a transparent, weighted, rank-transformed heuristic index for prioritisation. It is NOT a calibrated crash probability and must not be reported as one.",
    },
    benchmark: null,
    formulation: {
      title: "Multi-criteria composite vulnerability index",
      latex: "C_i=\\sum_{f} \\omega_f\\,\\mathrm{rank}_f(i),\\quad \\sum_f\\omega_f=1,\\ f\\in\\{\\text{EB risk},\\text{severity},\\text{geometry},\\text{environment},\\text{exposure gap}\\}",
      notes: [
        "Each facet is rank-transformed to [0,1] so that no single heavy-tailed metric dominates the index.",
        "Weights are user-configurable and always reported with the result — the index is fully auditable but remains heuristic.",
        "The exposure facet rewards units with observed AADT/VKT and penalises epistemic gaps.",
      ],
    },
    sampleSize: incidents.count,
    unitCount: risk.rows.length,
  };
}

/* ------------------------------------------------------------------ */
/* Ground-truth benchmarking across competing estimators               */
/* ------------------------------------------------------------------ */

async function benchmarkMethod(
  ctx: DatasetContext,
  params: AnalysisParams,
  incidents: Awaited<ReturnType<typeof loadIncidents>>,
  onProgress: ProgressFn,
  studyDays: number,
): Promise<MethodPayload> {
  const graph = ctx.graph;
  const gt = await groundTruthArrays(ctx);
  if (!gt.available) {
    return {
      features: null,
      stats: { method: "ground_truth_benchmark", available: false, reason: "dataset has no oracle λ (empirical dataset)" },
      benchmark: null,
      formulation: { title: "Ground-truth benchmarking", latex: "-", notes: ["Requires a synthetic dataset generated by the seeded network point process."] },
      sampleSize: 0,
      unitCount: 0,
    };
  }
  const points: WeightedPoint[] = incidents.records.map((r, i) => ({
    lixelIndex: r.lixelIndex,
    x: incidents.clusterPoints[i].x,
    y: incidents.clusterPoints[i].y,
    weight: r.weight,
  }));
  await onProgress(0.25, "nkde");
  const net = nkde(graph, points, { bandwidthM: params.bandwidthM ?? 300, kernel: params.kernel ?? "quartic", edgeCorrection: true, splitting: true });
  await onProgress(0.45, "planar");
  const pla = planarKde(graph, points, { bandwidthM: params.bandwidthM ?? 300, kernel: params.kernel ?? "quartic" });
  await onProgress(0.6, "raw_counts");
  const raw = new Array<number>(graph.lixels.length).fill(0);
  for (const r of incidents.records) raw[r.lixelIndex] += r.weight;
  await onProgress(0.75, "eb");
  const risk = await computeRisk(ctx, { ...params, level: "lixel" }, onProgress);
  const ebByLixel = new Map(risk.rows.map((r) => [r.unit.unitId, r.eb.estimate]));
  const ebArr = graph.lixels.map((l) => ebByLixel.get(l.id) ?? 0);

  const toPerLixel = (v: ArrayLike<number>) => Array.from({ length: graph.lixels.length }, (_, i) => v[i] * (graph.lixels[i].lengthM / 1000));
  const layers = [
    { label: "nkde_network", predicted: toPerLixel(net.values) },
    { label: "planar_kde", predicted: toPerLixel(pla.values) },
    { label: "raw_counts", predicted: raw },
    { label: "empirical_bayes", predicted: ebArr },
    { label: "oracle_lambda", predicted: gt.lambda },
  ];
  await onProgress(0.9, "scoring");
  const results = layers.map((l) =>
    evaluateAgainstGroundTruth({ predicted: l.predicted, trueLambda: gt.lambda, realizedCounts: gt.realized, label: l.label, topPercent: params.topPercent }),
  );

  // Bandwidth sensitivity sweep for the NKDE estimator.
  const sweep = [150, 250, 400, 600].map((h) => {
    const surf = nkde(graph, points, { bandwidthM: h, kernel: params.kernel ?? "quartic", edgeCorrection: true, splitting: true });
    const ev = evaluateAgainstGroundTruth({ predicted: toPerLixel(surf.values), trueLambda: gt.lambda, realizedCounts: gt.realized, label: `nkde_h${h}` });
    return { bandwidthM: h, pai10: ev.pai10, rri10: ev.rri10, rmseVsLambda: ev.rmseVsLambda, spearman: ev.spearmanVsLambda, runtimeMs: surf.runtimeMs };
  });

  const features: Feature[] = graph.lixels.map((l, i) =>
    lineFeature(
      ctx.crs,
      lixelGeometry(graph, i),
      {
        lixelId: l.id,
        trueLambda: round(gt.lambda[i], 6),
        realized: gt.realized[i],
        nkde: round(net.values[i] * (l.lengthM / 1000), 6),
        planar: round(pla.values[i] * (l.lengthM / 1000), 6),
        raw: round(raw[i], 6),
        eb: round(ebArr[i], 6),
        residual: round(net.values[i] * (l.lengthM / 1000) - gt.lambda[i], 6),
      },
      l.id,
    ),
  );

  return {
    features: fc(ctx.crs, features),
    stats: {
      method: "ground_truth_benchmark",
      available: true,
      studyDays,
      lixelCount: graph.lixels.length,
      incidentsUsed: incidents.count,
      oracleTotalLambda: round(gt.lambda.reduce((a, b) => a + b, 0), 4),
      oracleRealizedTotal: gt.realized.reduce((a, b) => a + b, 0),
      vgiTotalWeight: round(incidents.totalWeight, 4),
      bandwidthSweep: sweep,
      layers: results.map((r) => ({
        label: r.label,
        pai5: r.pai5,
        pai10: r.pai10,
        rri5: r.rri5,
        rri10: r.rri10,
        rmseVsLambda: r.rmseVsLambda,
        maeVsLambda: r.maeVsLambda,
        spearmanVsLambda: r.spearmanVsLambda,
        pearsonVsLambda: r.pearsonVsLambda,
        r2: r.r2VsLambda,
        biasRatio: r.biasRatio,
        curve: r.curve,
      })),
    },
    benchmark: { layers: results, sweep } as unknown as Record<string, unknown>,
    formulation: {
      title: "Stochastic ground-truth evaluation (PAI / RRI / RMSE)",
      latex: "\\mathrm{RRI}(k)=\\frac{a_k}{A},\\qquad \\mathrm{PAI}(k)=\\frac{a_k/A}{n_k/N},\\qquad \\mathrm{RMSE}=\\sqrt{\\tfrac1n\\sum_i(\\hat\\lambda_i-\\lambda_i)^2}",
      notes: [
        "a_k = oracle realised crashes captured by the top-k% of lixels ranked by the estimator; A = total oracle crashes; n_k/N = share of network units used.",
        "PAI normalises RRI by the area (network-length) share, so PAI = 1 for a random ranking and PAI → N/n for a perfect oracle.",
        "RMSE/MAE are computed after rescaling each estimator so Σλ̂ = Σλ, isolating *shape* recovery from scale bias.",
        "The oracle row is included as the attainable upper bound for this realisation of the point process.",
        "Bandwidth sensitivity is swept so that the reported PAI is not an artefact of a single h.",
      ],
    },
    sampleSize: incidents.count,
    unitCount: graph.lixels.length,
  };
}

export { epdoWeight };
