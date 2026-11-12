import { db } from "@/db";
import { accidents, roadLixels, spatialAnalysisJobs, spatialAnalysisResults, auditLogs } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { loadNetwork } from "@/lib/geo/loader";
import { benchmark, buildNetworkWeights, getisOrdGiStar, networkDBSCAN, networkKDE, planarKDE, type EventPoint, type KernelName } from "./network-stats";

export type JobKind = "nkde" | "gistar" | "ndbscan" | "benchmark";
export interface JobParams {
  kind: JobKind; bandwidth?: number; kernel?: KernelName; includeRaw?: boolean; planarCompare?: boolean;
  delta?: number; weightMode?: "gaussian" | "binary"; permutations?: number; variable?: "count" | "nkde";
  eps?: number; minPts?: number; topFraction?: number; severityWeighted?: boolean; benchmarkJobId?: number;
}

const g = globalThis as typeof globalThis & { __jobRunning?: boolean };

export async function enqueueJob(sourceId: number, params: JobParams) {
  const [job] = await db.insert(spatialAnalysisJobs).values({ sourceId, kind: params.kind, params: params as unknown as Record<string, unknown>, status: "queued" }).returning();
  // fire-and-forget asynchronous execution (in-process worker; job state tracked in DB)
  setTimeout(() => { runJob(job.id).catch(() => {}); }, 10);
  return job;
}

async function setProgress(id: number, progress: number) { await db.update(spatialAnalysisJobs).set({ progress }).where(eq(spatialAnalysisJobs.id, id)); }

async function loadEvents(sourceId: number, includeRaw: boolean, severityWeighted: boolean) {
  const statuses = includeRaw ? ["verified", "raw", "flagged"] : ["verified"];
  const rows = await db.select({ id: accidents.id, segmentId: accidents.segmentId, offsetM: accidents.offsetM, x: accidents.snapX, y: accidents.snapY, status: accidents.status, credibility: accidents.credibility, severityId: accidents.severityId })
    .from(accidents).where(and(eq(accidents.sourceId, sourceId), inArray(accidents.status, statuses), isNull(accidents.canonicalId)));
  const sevW: Record<number, number> = {};
  if (severityWeighted) { const { severityLevels } = await import("@/db/schema"); for (const s of await db.select().from(severityLevels)) sevW[s.id] = s.epdoWeight; }
  const ev: EventPoint[] = [];
  for (const r of rows) if (r.segmentId && r.offsetM !== null && r.x !== null && r.y !== null)
    ev.push({ id: r.id, p: { segmentId: r.segmentId, m: r.offsetM }, xy: [r.x, r.y], weight: (r.status === "verified" ? 1 : Math.max(0.2, r.credibility)) * (severityWeighted ? Math.log1p(sevW[r.severityId] ?? 1) : 1) });
  return ev;
}

export async function runJob(jobId: number) {
  const [job] = await db.select().from(spatialAnalysisJobs).where(eq(spatialAnalysisJobs.id, jobId));
  if (!job || job.status !== "queued") return;
  const t0 = Date.now();
  await db.update(spatialAnalysisJobs).set({ status: "running", startedAt: new Date() }).where(eq(spatialAnalysisJobs.id, jobId));
  try {
    const P = job.params as unknown as JobParams;
    const loaded = await loadNetwork(job.sourceId);
    if (!loaded) throw new Error("network not found");
    const { net, proj, lixelLonLat } = loaded;
    const progress = (f: number) => { void setProgress(jobId, Math.min(0.95, f)); };
    const events = await loadEvents(job.sourceId, !!P.includeRaw, !!P.severityWeighted);
    let summary: Record<string, unknown> = {}; let lixelValues: Record<string, unknown> = {}; let geojson: Record<string, unknown> | null = null;
    const lixelFeatures = (vals: Record<number, Record<string, unknown>>) => ({ type: "FeatureCollection", features: [...net.lixels.values()].map((l) => ({ type: "Feature", id: l.id, properties: { lixelId: l.id, segmentId: l.segmentId, ...vals[l.id] }, geometry: { type: "LineString", coordinates: lixelLonLat.get(l.id) } })) });

    if (P.kind === "nkde") {
      const h = P.bandwidth ?? 150, k = P.kernel ?? "gaussian";
      const nk = networkKDE(net, events, h, k, progress);
      const pk = P.planarCompare ? planarKDE(net, events, h, k) : null;
      const vals: Record<number, Record<string, unknown>> = {};
      const arrN: number[] = [], arrP: number[] = [];
      for (const [id, v] of nk) { const pv = pk?.get(id) ?? null; vals[id] = { nkde: v * 1000, planar: pv !== null ? pv * 1000 : null, diff: pv !== null ? (pv - v) * 1000 : null }; arrN.push(v * 1000); if (pv !== null) arrP.push(pv * 1000); }
      const q = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(p * (s.length - 1))] ?? 0; };
      let overest = 0, n = 0; if (pk) for (const [id, v] of nk) { const pv = pk.get(id)!; if (pv > v * 1.25 && pv > 0.5 * q(arrP, 0.5)) overest++; n++; }
      summary = { bandwidthM: h, kernel: k, events: events.length, units: "events per km (equal-split NKDE)", nkdeMax: Math.max(...arrN), nkdeP95: q(arrN, 0.95), planarMax: arrP.length ? Math.max(...arrP) : null, planarOverestimationShare: pk ? overest / n : null, method: "Okabe–Sugihara equal-split discontinuous NKDE over lixel midpoints; planar KDE uses the same kernel in R² scaled by effective corridor width." };
      lixelValues = vals; geojson = lixelFeatures(vals);
    } else if (P.kind === "gistar") {
      const delta = P.delta ?? 200;
      const W = buildNetworkWeights(net, delta, P.weightMode ?? "gaussian", (f) => progress(f * 0.5));
      const x = new Map<number, number>();
      for (const id of net.lixels.keys()) x.set(id, 0);
      if (P.variable === "nkde") { const nk = networkKDE(net, events, P.bandwidth ?? 100, "gaussian"); for (const [id, v] of nk) x.set(id, v * 1000); }
      else for (const e of events) { const l = net.lixelAt(e.p.segmentId, e.p.m); if (l) x.set(l.id, x.get(l.id)! + e.weight); }
      const res = getisOrdGiStar(x, W, P.permutations ?? 199);
      const vals: Record<number, Record<string, unknown>> = {};
      for (const r of res.results) vals[r.id] = { x: r.x, z: r.z, p: r.p, pPerm: r.pPerm, q: r.q, cls: r.cls };
      const count = (c: string) => res.results.filter((r) => r.cls === c).length;
      summary = { deltaM: delta, weightMode: P.weightMode ?? "gaussian", variable: P.variable ?? "count", permutations: P.permutations ?? 199, events: events.length, moranI: res.moranI, moranZ: res.moranZ, assumptions: res.assumptions, hot99: count("hot99"), hot95: count("hot95"), cold99: count("cold99"), cold95: count("cold95"), hotUncorrected: count("hot_uncorrected"), method: "Getis-Ord Gi* with network-distance Gaussian weights; conditional-permutation pseudo-p as non-parametric guard; Benjamini–Hochberg FDR (q) on analytical p." };
      lixelValues = vals; geojson = lixelFeatures(vals);
    } else if (P.kind === "ndbscan") {
      const eps = P.eps ?? 120, minPts = P.minPts ?? 4;
      const res = networkDBSCAN(net, events, eps, minPts, progress);
      const byId = new Map(events.map((e) => [e.id, e]));
      geojson = { type: "FeatureCollection", features: [
        ...res.clusters.filter((c) => c.hull.length >= 3).map((c) => ({ type: "Feature", properties: { cluster: c.cluster, size: c.size, segments: c.segmentIds.length, kind: "hull" }, geometry: { type: "Polygon", coordinates: [[...c.hull, c.hull[0]].map((p) => proj.toLonLat(p[0], p[1]))] } })),
        ...[...res.labels.entries()].map(([id, l]) => { const e = byId.get(id)!; return { type: "Feature", properties: { accidentId: id, cluster: l, kind: "point" }, geometry: { type: "Point", coordinates: proj.toLonLat(e.xy[0], e.xy[1]) } }; }),
      ] };
      summary = { epsM: eps, minPts, events: events.length, clusters: res.clusters.length, noise: res.noise, clusterTable: res.clusters.map((c) => ({ cluster: c.cluster, size: c.size, segments: c.segmentIds })), method: "DBSCAN with ε evaluated as shortest-path network distance (Dijkstra over node graph + LRS offsets)." };
      lixelValues = { clusters: res.clusters.map((c) => ({ cluster: c.cluster, members: c.members, segmentIds: c.segmentIds })) };
    } else if (P.kind === "benchmark") {
      const truthRows = await db.select({ id: roadLixels.id, t: roadLixels.trueIntensity, len: roadLixels.lengthM }).from(roadLixels).where(eq(roadLixels.sourceId, job.sourceId));
      const truth = new Map(truthRows.map((r) => [r.id, r.t ?? 0])); const lens = new Map(truthRows.map((r) => [r.id, r.len]));
      const h = P.bandwidth ?? 150, k = P.kernel ?? "gaussian";
      const nk = networkKDE(net, events, h, k, (f) => progress(f * 0.6));
      const pk = planarKDE(net, events, h, k);
      const counts = new Map<number, number>(); for (const id of net.lixels.keys()) counts.set(id, 0);
      for (const e of events) { const l = net.lixelAt(e.p.segmentId, e.p.m); if (l) counts.set(l.id, counts.get(l.id)! + e.weight); }
      const tf = P.topFraction ?? 0.1;
      const bN = benchmark(nk, truth, lens, tf), bP = benchmark(pk, truth, lens, tf), bC = benchmark(counts, truth, lens, tf);
      const vals: Record<number, Record<string, unknown>> = {};
      const sumT = truthRows.reduce((a, r) => a + (r.t ?? 0), 0) || 1, sumN = [...nk.values()].reduce((a, b) => a + b, 0) || 1;
      for (const r of truthRows) vals[r.id] = { truth: (r.t ?? 0) * 1000, nkde: (nk.get(r.id) ?? 0) * 1000, residual: ((nk.get(r.id) ?? 0) / sumN - (r.t ?? 0) / sumT) * 1000 };
      summary = { bandwidthM: h, kernel: k, events: events.length, topFraction: tf, nkde: bN, planar: bP, rawCounts: bC, method: "Layers normalised to unit mass; PAI = hit-rate / length-fraction for top-X% lixels; RRI = PAI / PAI of oracle ordering; RMSE on normalised intensities." };
      lixelValues = vals; geojson = lixelFeatures(vals);
    }
    await db.insert(spatialAnalysisResults).values({ jobId, summary, lixelValues, geojson });
    await db.update(spatialAnalysisJobs).set({ status: "done", progress: 1, finishedAt: new Date(), runtimeMs: Date.now() - t0, sampleSize: events.length }).where(eq(spatialAnalysisJobs.id, jobId));
    await db.insert(auditLogs).values({ entity: "spatial_analysis_jobs", entityId: jobId, action: "completed", details: { kind: job.kind, runtimeMs: Date.now() - t0 } });
  } catch (e) {
    await db.update(spatialAnalysisJobs).set({ status: "failed", error: String((e as Error).message ?? e), finishedAt: new Date(), runtimeMs: Date.now() - t0 }).where(eq(spatialAnalysisJobs.id, jobId));
  } finally { g.__jobRunning = false; }
}
