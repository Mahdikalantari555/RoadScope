import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { accidents, datasetSources, roadLixels, roadSegments, vgiReports } from "@/db/schema";
import { seedReferenceData } from "@/lib/bootstrap";
import { simulateDataset } from "@/lib/sim/simulate";
import { clearGraphCache, loadDataset } from "@/lib/geo/datasetGraph";
import { runMethod } from "@/lib/analysis/methods";
import { GET as datasetsGET } from "@/app/api/datasets/route";
import { GET as networkGET } from "@/app/api/datasets/[id]/network/route";
import { GET as incidentsGET } from "@/app/api/datasets/[id]/incidents/route";
import { GET as statsGET } from "@/app/api/datasets/[id]/stats/route";
import { GET as qualityGET } from "@/app/api/datasets/[id]/quality/route";
import { GET as riskGET } from "@/app/api/datasets/[id]/risk/route";
import { POST as reportsPOST } from "@/app/api/reports/route";
import { POST as candidatesPOST } from "@/app/api/reports/candidates/route";
import { POST as jobsPOST } from "@/app/api/analysis/jobs/route";
import { GET as jobGET } from "@/app/api/analysis/jobs/[id]/route";
import type { DatasetSource } from "@/db/schema";

const SLUG = `e2e-test-${Date.now()}`;
let dataset: DatasetSource;
let datasetId: string;

beforeAll(async () => {
  const ref = await seedReferenceData();
  dataset = await simulateDataset({
    name: "E2E Test Network",
    slug: SLUG,
    scenario: "intersection_clustered",
    seed: 4242,
    lixelLengthM: 50,
    studyDays: 180,
    network: { gridCols: 8, gridRows: 7, blockXM: 210, blockYM: 200, seed: 4242 },
    severityIds: ref.severityIds,
    categoryIds: ref.categoryIds,
    contributorIds: ref.contributorIds,
  });
  datasetId = dataset.id;
  clearGraphCache();
}, 600000);

afterAll(async () => {
  if (!datasetId) return;
  await db.delete(vgiReports).where(eq(vgiReports.datasetId, datasetId));
  await db.delete(accidents).where(eq(accidents.datasetId, datasetId));
  await db.delete(roadLixels).where(eq(roadLixels.datasetId, datasetId));
  await db.delete(roadSegments).where(eq(roadSegments.datasetId, datasetId));
  await db.delete(datasetSources).where(eq(datasetSources.id, datasetId));
  clearGraphCache();
  await db.$client.end().catch(() => undefined);
});

describe("Phase 1 — stochastic network ground-truth simulation", () => {
  it("produces a connected topology with LRS lixels and provenance", () => {
    expect(dataset.networkStats).not.toBeNull();
    const s = dataset.networkStats!;
    expect(s.nodeCount).toBeGreaterThan(30);
    expect(s.segmentCount).toBeGreaterThan(50);
    expect(s.lixelCount).toBeGreaterThan(200);
    expect(s.totalLengthKm).toBeGreaterThan(5);
    expect(s.meanNodeDegree).toBeGreaterThan(1.5);
    expect(s.betaGamma.gamma).toBeGreaterThan(0);
    expect(dataset.groundTruthAvailable).toBe(true);
    expect(dataset.kind).toBe("synthetic");
    expect(dataset.srid).toBe(32633);
    expect(dataset.lixelLengthM).toBe(50);
  });

  it("realises crashes from the point process and injects VGI noise", async () => {
    const counts = dataset.recordCounts!;
    expect(counts.groundTruthAccidents).toBeGreaterThan(5);
    expect(counts.vgiReports).toBeGreaterThan(5);
    expect(counts.falseAlarms).toBeGreaterThan(0);
    const expected = (dataset.simParams as any).expectedTotalCrashes as number;
    // Poisson realisation should be within a sane band of its expectation
    expect(counts.groundTruthAccidents).toBeGreaterThan(expected * 0.5);
    expect(counts.groundTruthAccidents).toBeLessThan(expected * 1.8);
  });

  it("keeps oracle and observed incidents strictly separated", async () => {
    const truth = await db.select().from(accidents).where(and(eq(accidents.datasetId, datasetId), eq(accidents.isGroundTruth, true)));
    const observed = await db.select().from(accidents).where(and(eq(accidents.datasetId, datasetId), eq(accidents.isGroundTruth, false)));
    expect(truth.length).toBeGreaterThan(0);
    expect(observed.length).toBeGreaterThan(0);
    expect(truth.every((t) => t.narrative?.includes("GROUND TRUTH"))).toBe(true);
    expect(observed.every((o) => o.status !== "verified" || o.witnessCount > 0)).toBe(true);
  });

  it("map-matches every report and preserves raw provenance", async () => {
    const reports = await db.select().from(vgiReports).where(eq(vgiReports.datasetId, datasetId));
    expect(reports.length).toBeGreaterThan(0);
    expect(reports.every((r) => Number.isFinite(r.rawX) && Number.isFinite(r.rawY))).toBe(true);
    expect(reports.filter((r) => r.snappedX !== null).length).toBe(reports.length);
    expect(reports.every((r) => r.mapMatch !== null)).toBe(true);
    const drifts = reports.map((r) => r.snapPerpDistanceM ?? 0);
    expect(Math.max(...drifts)).toBeGreaterThanOrEqual(0);
    // injected drift must be non-trivial (the noise model is active)
    const injected = reports.map((r) => r.injectedDriftM).filter((v): v is number => typeof v === "number");
    expect(injected.length).toBeGreaterThan(0);
    expect(injected.reduce((a, b) => a + b, 0) / injected.length).toBeGreaterThan(2);
    // snapping must reduce positional error relative to the raw drift
    const paired = reports.filter((r) => r.injectedDriftM !== null && r.snapPerpDistanceM !== null);
    const meanDrift = paired.reduce((s, r) => s + (r.injectedDriftM as number), 0) / paired.length;
    const meanResidual = paired.reduce((s, r) => s + (r.snapPerpDistanceM as number), 0) / paired.length;
    expect(meanResidual).toBeLessThan(meanDrift);
  });

  it("assigns linear offsets within the parent edge bounds", async () => {
    const lixels = await db.select().from(roadLixels).where(eq(roadLixels.datasetId, datasetId)).limit(400);
    const segments = await db.select().from(roadSegments).where(eq(roadSegments.datasetId, datasetId));
    const byId = new Map(segments.map((s) => [s.id, s]));
    for (const l of lixels) {
      const s = byId.get(l.segmentId)!;
      expect(l.mStart).toBeGreaterThanOrEqual(0);
      expect(l.mEnd).toBeLessThanOrEqual(s.curvilinearLengthM + 1e-6);
      expect(l.mMid).toBeGreaterThan(l.mStart);
      expect(l.mMid).toBeLessThan(l.mEnd);
    }
  });

  it("is reproducible from the seed", async () => {
    const ref = await seedReferenceData();
    const clone = await simulateDataset({
      name: "E2E Clone",
      slug: `${SLUG}-clone`,
      scenario: "intersection_clustered",
      seed: 4242,
      lixelLengthM: 50,
      studyDays: 180,
      network: { gridCols: 8, gridRows: 7, blockXM: 210, blockYM: 200, seed: 4242 },
      severityIds: ref.severityIds,
      categoryIds: ref.categoryIds,
      contributorIds: ref.contributorIds,
    });
    expect(clone.recordCounts!.groundTruthAccidents).toBe(dataset.recordCounts!.groundTruthAccidents);
    expect(clone.networkStats!.lixelCount).toBe(dataset.networkStats!.lixelCount);
    expect(clone.networkStats!.totalLengthKm).toBe(dataset.networkStats!.totalLengthKm);
    await db.delete(vgiReports).where(eq(vgiReports.datasetId, clone.id));
    await db.delete(accidents).where(eq(accidents.datasetId, clone.id));
    await db.delete(roadLixels).where(eq(roadLixels.datasetId, clone.id));
    await db.delete(roadSegments).where(eq(roadSegments.datasetId, clone.id));
    await db.delete(datasetSources).where(eq(datasetSources.id, clone.id));
  }, 600000);
});

describe("Phase 3/4 — analysis engine over the persisted dataset", () => {
  it("runs NKDE, planar comparison and benchmarking", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const payload = await runMethod(ctx, "nkde", { bandwidthM: 220, kernel: "quartic", edgeCorrection: true, splitting: true });
    expect(payload.features).not.toBeNull();
    expect((payload.features as any).features.length).toBe(ctx.graph.lixels.length);
    expect((payload.stats as any).comparison.pearson).toBeDefined();
    expect(payload.benchmark).not.toBeNull();
    expect((payload.benchmark as any).pai10).toBeGreaterThan(0);
    expect(payload.formulation.latex).toContain("d_N");
  }, 600000);

  it("runs network Gi* with permutation inference and FDR", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const payload = await runMethod(ctx, "network_getis_ord", { bandwidthM: 220, permutations: 199, weightMode: "distance_decay" });
    const stats = payload.stats as any;
    expect(stats.assumptions.length).toBeGreaterThanOrEqual(4);
    expect(stats.permutations).toBe(199);
    expect(typeof stats.globalMoranI).toBe("number");
    expect(stats.hotspots + stats.coldspots).toBeLessThanOrEqual(stats.n);
  }, 600000);

  it("runs N-DBSCAN with network epsilon", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const payload = await runMethod(ctx, "n_dbscan", { epsilonM: 250, minPoints: 3 });
    const stats = payload.stats as any;
    expect(stats.clusterCount).toBeGreaterThanOrEqual(0);
    expect(stats.epsilonM).toBe(250);
    expect(stats.noiseCount + stats.clusteredShare * stats.clusterCount).toBeGreaterThanOrEqual(0);
  }, 600000);

  it("runs Empirical Bayes smoothing and persists risk estimates", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const payload = await runMethod(ctx, "eb_smoothing", { level: "segment", persist: true });
    const stats = payload.stats as any;
    expect(stats.spf).not.toBeNull();
    expect(stats.spf.phi).toBeGreaterThan(0);
    expect(stats.persistedRows).toBeGreaterThan(0);
    expect(stats.disclaimer).toContain("not calibrated probabilities");
  }, 600000);

  it("benchmarks every estimator against the oracle λ", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const payload = await runMethod(ctx, "ground_truth_benchmark", { bandwidthM: 220 });
    const stats = payload.stats as any;
    expect(stats.available).toBe(true);
    expect(stats.layers.length).toBe(5);
    const nkdeLayer = stats.layers.find((l: any) => l.label === "nkde_network");
    const planarLayer = stats.layers.find((l: any) => l.label === "planar_kde");
    expect(nkdeLayer.pai10).toBeGreaterThan(0);
    expect(planarLayer.pai10).toBeGreaterThan(0);
    expect(stats.bandwidthSweep.length).toBe(4);
  }, 600000);
});

describe("API contract layer", () => {
  it("GET /api/datasets lists the registry", async () => {
    const res = await datasetsGET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.datasets.some((d: any) => d.id === datasetId)).toBe(true);
    expect(body.scenarios.length).toBe(4);
  });

  it("GET /api/datasets/:id/network serialises GeoJSON in CRS84", async () => {
    const res = await networkGET(new Request("http://x/api/network"), { params: Promise.resolve({ id: datasetId }) });
    const body = await res.json();
    expect(body.geojson.type).toBe("FeatureCollection");
    expect(body.geojson.crs.properties.name).toContain("CRS84");
    const line = body.geojson.features.find((f: any) => f.geometry.type === "LineString");
    expect(line.properties.kind).toBe("segment");
    expect(Math.abs(line.geometry.coordinates[0][0])).toBeLessThanOrEqual(180);
    expect(Math.abs(line.geometry.coordinates[0][1])).toBeLessThanOrEqual(90);
  });

  it("GET /api/datasets/:id/incidents never leaks ground truth by default", async () => {
    const res = await incidentsGET(new Request("http://x/api/i"), { params: Promise.resolve({ id: datasetId }) });
    const body = await res.json();
    expect(body.groundTruth).toBe(false);
    expect(body.geojson.features.every((f: any) => f.properties.isGroundTruth === false)).toBe(true);
    const gt = await incidentsGET(new Request("http://x/api/i?groundTruth=1"), { params: Promise.resolve({ id: datasetId }) });
    const gtBody = await gt.json();
    expect(gtBody.geojson.features.every((f: any) => f.properties.isGroundTruth === true)).toBe(true);
  });

  it("GET /api/datasets/:id/stats honours the cross-filter contract", async () => {
    const res = await statsGET(new Request("http://x/api/s?bin=month"), { params: Promise.resolve({ id: datasetId }) });
    const body = await res.json();
    expect(body.totals.incidents).toBeGreaterThan(0);
    expect(body.diurnalMatrix).toHaveLength(7);
    expect(body.severityMix.length).toBeGreaterThan(0);
    expect(body.vgi.reports).toBeGreaterThan(0);
    const filtered = await statsGET(new Request("http://x/api/s?severity=fatal&bin=week"), { params: Promise.resolve({ id: datasetId }) });
    const fbody = await filtered.json();
    expect(fbody.totals.incidents).toBeLessThanOrEqual(body.totals.incidents);
  });

  it("GET /api/datasets/:id/quality reports VGI diagnostics", async () => {
    const res = await qualityGET(new Request("http://x/api/q"), { params: Promise.resolve({ id: datasetId }) });
    const body = await res.json();
    expect(body.provenance.synthetic).toBe(true);
    expect(body.volumes.reports).toBeGreaterThan(0);
    expect(body.positionalQuality.driftHistogram.length).toBeGreaterThan(0);
    expect(body.temporalQuality.medianLagSeconds).toBeGreaterThan(0);
    expect(body.rates.falseAlarmRatePct).toBeGreaterThanOrEqual(0);
  });

  it("GET /api/datasets/:id/risk returns all four metric tiers + uncertainty", async () => {
    const res = await riskGET(new Request("http://x/api/r?level=segment&metric=eb"), { params: Promise.resolve({ id: datasetId }) });
    const body = await res.json();
    expect(body.metrics).toEqual(["count", "density", "epdo", "rate", "eb", "psi", "composite", "uncertainty"]);
    expect(body.unitCount).toBeGreaterThan(0);
    expect(body.geojson.features[0].properties.ebEstimate).toBeGreaterThanOrEqual(0);
    expect(body.summary.exposureCoveragePct).toBeGreaterThan(0);
    expect(body.disclaimer).toContain("not calibrated crash probabilities");
  }, 600000);

  it("POST /api/reports validates coordinates, time and taxonomy", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const centre = ctx.graph.lixels[Math.floor(ctx.graph.lixels.length / 2)];
    const { toWgs84 } = await import("@/lib/geo/projection");
    const lonLat = toWgs84(centre.x, centre.y, ctx.crs);
    const good = await reportsPOST(
      new Request("http://x/api/reports", {
        method: "POST",
        headers: { "x-uai-role": "citizen_reporter" },
        body: JSON.stringify({
          datasetId, lon: lonLat.lon, lat: lonLat.lat, positionalAccuracyM: 12,
          occurrenceTime: new Date(Date.now() - 3600e3).toISOString(),
          severityCode: "minor_injury", categoryCode: "rear_end", vehicleCount: 2, injuredCount: 1,
          narrative: "Test submission", emergencyResponse: true,
        }),
      }),
    );
    expect(good.status).toBe(201);
    const goodBody = await good.json();
    expect(goodBody.status).toBe("unverified");
    expect(goodBody.snapped.posterior).toBeGreaterThan(0);
    expect(goodBody.privacy.mediaMetadataStripped).toBe(true);

    const badLon = await reportsPOST(
      new Request("http://x/api/reports", { method: "POST", headers: { "x-uai-role": "citizen_reporter" }, body: JSON.stringify({ datasetId, lon: 999, lat: 10 }) }),
    );
    expect(badLon.status).toBe(400);

    const future = await reportsPOST(
      new Request("http://x/api/reports", {
        method: "POST", headers: { "x-uai-role": "citizen_reporter" },
        body: JSON.stringify({ datasetId, lon: lonLat.lon, lat: lonLat.lat, occurrenceTime: new Date(Date.now() + 86400e3).toISOString() }),
      }),
    );
    expect(future.status).toBe(400);

    const inconsistent = await reportsPOST(
      new Request("http://x/api/reports", {
        method: "POST", headers: { "x-uai-role": "citizen_reporter" },
        body: JSON.stringify({ datasetId, lon: lonLat.lon, lat: lonLat.lat, severityCode: "fatal", fatalityCount: 2, injuredCount: 1, emergencyResponse: false }),
      }),
    );
    expect(inconsistent.status).toBe(400);

    const outside = await reportsPOST(
      new Request("http://x/api/reports", { method: "POST", headers: { "x-uai-role": "citizen_reporter" }, body: JSON.stringify({ datasetId, lon: 0, lat: 0 }) }),
    );
    expect(outside.status).toBe(422);
  }, 600000);

  it("POST /api/reports/candidates returns network-neighbourhood duplicates", async () => {
    const ctx = (await loadDataset(datasetId))!;
    const rows = await db.select().from(accidents).where(and(eq(accidents.datasetId, datasetId), eq(accidents.isGroundTruth, false))).limit(1);
    const target = rows[0];
    const { toWgs84 } = await import("@/lib/geo/projection");
    const lonLat = toWgs84(target.x!, target.y!, ctx.crs);
    const res = await candidatesPOST(
      new Request("http://x/api/reports/candidates", {
        method: "POST",
        body: JSON.stringify({ datasetId, lon: lonLat.lon + 0.0002, lat: lonLat.lat, occurrenceTime: target.occurredAt.toISOString(), networkDistanceM: 250, timeWindowMinutes: 180 }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.candidates.length).toBeGreaterThan(0);
    expect(body.candidates[0].accidentId).toBe(target.id);
    expect(body.candidates[0].networkDistanceM).toBeGreaterThanOrEqual(0);
    expect(body.candidates[0].recommendation).toBe("strong_duplicate_candidate");
  }, 600000);

  it("POST /api/analysis/jobs runs asynchronously with progress then caches", async () => {
    const submit = await jobsPOST(
      new Request("http://x/api/analysis/jobs", {
        method: "POST",
        headers: { "x-uai-role": "researcher" },
        body: JSON.stringify({ datasetId, method: "nkde", params: { bandwidthM: 260, kernel: "gaussian" }, wait: true }),
      }),
    );
    expect(submit.status).toBe(202);
    const submitted = await submit.json();
    expect(submitted.status).toBe("succeeded");
    const detail = await jobGET(new Request("http://x/api/analysis/jobs/" + submitted.jobId), { params: Promise.resolve({ id: submitted.jobId }) });
    const detailBody = await detail.json();
    expect(detailBody.job.progress).toBe(1);
    expect(detailBody.result.stats.bandwidthM).toBe(260);
    expect(detailBody.result.features.features.length).toBeGreaterThan(0);

    const cached = await jobsPOST(
      new Request("http://x/api/analysis/jobs", {
        method: "POST",
        headers: { "x-uai-role": "researcher" },
        body: JSON.stringify({ datasetId, method: "nkde", params: { kernel: "gaussian", bandwidthM: 260 } }),
      }),
    );
    const cachedBody = await cached.json();
    expect(cachedBody.cached).toBe(true);
    expect(cachedBody.resultId).toBe(detailBody.result.id);

    const invalid = await jobsPOST(
      new Request("http://x/api/analysis/jobs", { method: "POST", headers: { "x-uai-role": "researcher" }, body: JSON.stringify({ datasetId, method: "not_a_method" }) }),
    );
    expect(invalid.status).toBe(400);

    const badBandwidth = await jobsPOST(
      new Request("http://x/api/analysis/jobs", { method: "POST", headers: { "x-uai-role": "researcher" }, body: JSON.stringify({ datasetId, method: "nkde", params: { bandwidthM: 5 } }) }),
    );
    expect(badBandwidth.status).toBe(400);
  }, 600000);

  it("enforces RBAC on stewardship and analysis endpoints", async () => {
    const forbidden = await jobsPOST(
      new Request("http://x/api/analysis/jobs", { method: "POST", headers: { "x-uai-role": "citizen_reporter" }, body: JSON.stringify({ datasetId, method: "nkde", params: {} }) }),
    );
    expect(forbidden.status).toBe(403);
  });
});
