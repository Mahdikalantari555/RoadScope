/** Analysis orchestration: loads filtered data, runs pure geo algorithms, emits GeoJSON + summaries. */
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { accidents, datasetSources, environmentalObservations } from "@/db/schema";
import { DEFAULT_ANALYSIS_STATUSES, SEVERITIES, type AnalysisMethod, type Filters } from "@/lib/domain";
import { clarkEvans, dbscan, kDistanceCurve } from "@/lib/geo/cluster";
import type { XY } from "@/lib/geo/geometry";
import { getisOrdGiStar, giAssumptions, globalMoransI, type AreaUnit } from "@/lib/geo/hotspot";
import { kde } from "@/lib/geo/kde";
import { assessRisk, type RiskConfig } from "@/lib/geo/risk";
import { gini, poissonCI } from "@/lib/geo/stats";
import { compareRates, temporalProfile } from "@/lib/geo/temporal";
import { CITY_TIMEZONE, lightCondition, localParts } from "@/lib/geo/time";
import { fromUtm } from "@/lib/geo/projection";
import { getNetwork, loadAccidents, networkDatasetId, SNAP_MAX_M, toLonLat, type AccidentRow } from "./data";
import { ApiError } from "./http";

type Feature = { type: "Feature"; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> };
export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}
export interface AnalysisOutput {
  summary: Record<string, unknown>;
  geojson: FeatureCollection | null;
  table: Record<string, unknown>[] | null;
}

export const paramSchemas = {
  kde: z.object({ cellSize: z.number().min(25).max(500).default(100), bandwidth: z.number().min(25).max(3000).nullable().default(null), kernel: z.enum(["quartic", "epanechnikov", "gaussian"]).default("quartic"), weight: z.enum(["none", "epdo"]).default("none") }),
  gistar: z.object({ unit: z.enum(["grid", "segment"]).default("grid"), cellSize: z.number().min(50).max(1000).default(200), band: z.number().min(100).max(3000).default(500), fdr: z.boolean().default(true), weight: z.enum(["none", "epdo"]).default("none") }),
  dbscan: z.object({ eps: z.number().min(5).max(1000).default(60), minPts: z.number().int().min(2).max(200).default(8) }),
  nearest: z.object({ maxDistance: z.number().min(5).max(500).default(SNAP_MAX_M) }),
  segments: z.object({ metric: z.enum(["count", "density", "epdo"]).default("density") }),
  temporal: z.object({}).default({}),
  environment: z.object({}).default({}),
  pattern: z.object({ cellSize: z.number().min(50).max(1000).default(200), band: z.number().min(100).max(3000).default(500) }),
} satisfies Record<AnalysisMethod, z.ZodType>;

export const riskSchema = z.object({
  epdoWeights: z.record(z.string(), z.number().min(0).max(1000)).default(Object.fromEntries(SEVERITIES.map((s) => [s.code, s.epdoWeight]))),
  weights: z
    .object({ frequency: z.number().min(0), severity: z.number().min(0), exposure: z.number().min(0), road: z.number().min(0), environment: z.number().min(0) })
    .default({ frequency: 0.35, severity: 0.25, exposure: 0.2, road: 0.1, environment: 0.1 }),
  useEmpiricalBayes: z.boolean().default(true),
  useExposure: z.boolean().default(true),
  topK: z.number().int().min(1).max(200).default(20),
  simulations: z.number().int().min(0).max(1000).default(300),
});

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const cellRing = (x: number, y: number, s: number): [number, number][] =>
  [
    [x - s / 2, y - s / 2],
    [x + s / 2, y - s / 2],
    [x + s / 2, y + s / 2],
    [x - s / 2, y + s / 2],
    [x - s / 2, y - s / 2],
  ].map(([a, b]) => {
    const [lon, lat] = fromUtm(a, b);
    return [r6(lon), r6(lat)];
  });

function spanYears(rows: AccidentRow[], f: Filters): number {
  if (f.from && f.to) return Math.max(1 / 365, (Date.parse(f.to) - Date.parse(f.from) + 86400000) / (365.25 * 86400000));
  if (!rows.length) return 1;
  const min = f.from ? Date.parse(f.from) : rows[0].t;
  const max = f.to ? Date.parse(f.to) + 86400000 : rows[rows.length - 1].t;
  return Math.max(1 / 12, (max - min) / (365.25 * 86400000));
}

async function context() {
  const net = await getNetwork();
  if (!net) throw new ApiError(409, "No road network available — generate a dataset first.");
  const pad = 150;
  const extent = { minX: net.extent.minX - pad, minY: net.extent.minY - pad, maxX: net.extent.maxX + pad, maxY: net.extent.maxY + pad };
  const mask = (x: number, y: number) => net.grid.distanceTo([x, y], 150) <= 150;
  return { net, extent, mask };
}

const weightOf = (r: AccidentRow, mode: "none" | "epdo") => (mode === "epdo" ? (SEVERITIES.find((s) => s.code === r.severity)?.epdoWeight ?? 1) : 1);

function lattice(rows: AccidentRow[], extent: { minX: number; minY: number }, s: number, mask: (x: number, y: number) => boolean, weight: "none" | "epdo", nx: number, ny: number) {
  const counts = new Map<string, { v: number; ids: number[] }>();
  for (const r of rows) {
    const i = Math.floor((r.x - extent.minX) / s);
    const j = Math.floor((r.y - extent.minY) / s);
    const k = `${i}:${j}`;
    const c = counts.get(k) ?? { v: 0, ids: [] };
    c.v += weightOf(r, weight);
    c.ids.push(r.id);
    counts.set(k, c);
  }
  const units: (AreaUnit & { ids: number[] })[] = [];
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const x = extent.minX + (i + 0.5) * s;
      const y = extent.minY + (j + 0.5) * s;
      const c = counts.get(`${i}:${j}`);
      if (!c && !mask(x, y)) continue;
      units.push({ id: `${i}:${j}`, x, y, value: c?.v ?? 0, ids: c?.ids ?? [] });
    }
  return units;
}

export async function runAnalysis(method: AnalysisMethod, rawParams: unknown, filters: Filters, progress: (p: number, msg: string) => Promise<void> = async () => {}): Promise<AnalysisOutput> {
  const statuses = filters.statuses?.length ? filters.statuses : DEFAULT_ANALYSIS_STATUSES;
  const f = { ...filters, statuses };
  await progress(10, "Loading accident layer");
  const rows = await loadAccidents(f);
  const base = { method, n: rows.length, statuses, filters: f, crs: "EPSG:32633 (metric) → EPSG:4326 (output)", syntheticData: rows.some((r) => r.isSynthetic) };
  await progress(30, "Preparing study area");
  const { net, extent, mask } = await context();

  switch (method) {
    case "kde": {
      const p = paramSchemas.kde.parse(rawParams ?? {});
      await progress(50, "Estimating density surface");
      const res = kde(rows.map((r) => ({ x: r.x, y: r.y, w: weightOf(r, p.weight) })), extent, { cellSize: p.cellSize, bandwidth: p.bandwidth, kernel: p.kernel }, mask);
      const features: Feature[] = res.cells
        .filter((c) => c.value >= res.max * 0.01)
        .map((c) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [cellRing(c.x, c.y, res.cellSize)] }, properties: { value: Math.round(c.value * 100) / 100, rel: Math.round((c.value / res.max) * 1000) / 1000 } }));
      return { summary: { ...base, params: p, bandwidth: res.bandwidth, bandwidthRule: res.bandwidthRule, max: res.max, unit: p.weight === "epdo" ? "EPDO-weighted events / km²" : res.unit, cells: features.length, totalMass: res.totalMass }, geojson: { type: "FeatureCollection", features }, table: null };
    }
    case "gistar":
    case "pattern": {
      const p = method === "gistar" ? paramSchemas.gistar.parse(rawParams ?? {}) : { ...paramSchemas.pattern.parse(rawParams ?? {}), unit: "grid" as const, fdr: true, weight: "none" as const };
      const s = p.cellSize;
      const nx = Math.ceil((extent.maxX - extent.minX) / s);
      const ny = Math.ceil((extent.maxY - extent.minY) / s);
      let units: (AreaUnit & { ids: number[]; lengthM?: number; name?: string })[];
      if (p.unit === "segment") {
        const by = new Map<number, number[]>();
        for (const r of rows) if (r.segmentId) (by.get(r.segmentId) ?? by.set(r.segmentId, []).get(r.segmentId)!).push(r.id);
        const valOf = new Map<number, number>();
        for (const r of rows) if (r.segmentId) valOf.set(r.segmentId, (valOf.get(r.segmentId) ?? 0) + weightOf(r, p.weight));
        units = net.segments.map((sg) => {
          const mid = sg.geomProj[Math.floor(sg.geomProj.length / 2)];
          return { id: sg.id, x: mid[0], y: mid[1], value: (valOf.get(sg.id) ?? 0) / (sg.lengthM / 1000), ids: by.get(sg.id) ?? [], lengthM: sg.lengthM, name: sg.name };
        });
      } else units = lattice(rows, extent, s, mask, p.weight, nx, ny);
      await progress(50, "Global Moran's I (permutation inference)");
      const moran = units.length >= 3 ? globalMoransI(units, p.band, 499) : null;
      const checks = giAssumptions(units, p.band, rows.length, moran);
      if (method === "pattern") {
        await progress(75, "Nearest-neighbour index and concentration");
        const area = units.length * s * s;
        const ce = clarkEvans(rows.map((r) => [r.x, r.y] as XY), area);
        const segCounts = new Map<number, number>();
        for (const r of rows) if (r.segmentId) segCounts.set(r.segmentId, (segCounts.get(r.segmentId) ?? 0) + 1);
        const segs = net.segments.map((sg) => ({ c: segCounts.get(sg.id) ?? 0, l: sg.lengthM })).sort((a, b) => b.c / b.l - a.c / a.l);
        const totalLen = segs.reduce((a, b) => a + b.l, 0);
        let accLen = 0;
        let accC = 0;
        const lorenz: [number, number][] = [[0, 0]];
        for (const sg of segs) {
          accLen += sg.l;
          accC += sg.c;
          lorenz.push([accLen / totalLen, rows.length ? accC / rows.length : 0]);
        }
        const share5 = lorenz.find((l) => l[0] >= 0.05)?.[1] ?? 0;
        const mx = rows.reduce((a, r) => a + r.x, 0) / Math.max(1, rows.length);
        const my = rows.reduce((a, r) => a + r.y, 0) / Math.max(1, rows.length);
        const sd = Math.sqrt(rows.reduce((a, r) => a + (r.x - mx) ** 2 + (r.y - my) ** 2, 0) / Math.max(1, rows.length));
        const circle: [number, number][] = [];
        for (let k = 0; k <= 64; k++) circle.push(toLonLat([mx + sd * Math.cos((k / 64) * 2 * Math.PI), my + sd * Math.sin((k / 64) * 2 * Math.PI)]));
        return {
          summary: { ...base, params: p, clarkEvans: ce, moran, studyAreaKm2: area / 1e6, giniSegments: gini(segs.map((x) => x.c / x.l)), shareOnTop5PctLength: share5, lorenz: lorenz.filter((_, i) => i % Math.max(1, Math.floor(lorenz.length / 100)) === 0), meanCentre: toLonLat([mx, my]), standardDistanceM: sd },
          geojson: {
            type: "FeatureCollection",
            features: rows.length
              ? [
                  { type: "Feature", geometry: { type: "Polygon", coordinates: [circle] }, properties: { kind: "standard_distance", radiusM: Math.round(sd) } },
                  { type: "Feature", geometry: { type: "Point", coordinates: toLonLat([mx, my]) }, properties: { kind: "mean_centre" } },
                ]
              : [],
          },
          table: null,
        };
      }
      const blocking = checks.filter((c) => c.blocking && !c.passed);
      if (blocking.length) return { summary: { ...base, params: p, skipped: true, reason: "Statistical pre-conditions for Gi* not met", checks, moran }, geojson: { type: "FeatureCollection", features: [] }, table: null };
      await progress(70, "Computing local Gi* statistics");
      const gi = getisOrdGiStar(units, p.band, p.fdr);
      const classes: Record<string, number> = {};
      gi.forEach((g) => (classes[g.cls] = (classes[g.cls] ?? 0) + 1));
      const features: Feature[] = gi.map((g, i) => {
        const u = units[i];
        const geometry =
          p.unit === "segment" ? { type: "LineString", coordinates: net.byId.get(u.id as number)!.geom } : { type: "Polygon", coordinates: [cellRing(u.x, u.y, s)] };
        return { type: "Feature", geometry, properties: { unitId: u.id, value: Math.round(g.value * 100) / 100, z: Math.round(g.z * 1000) / 1000, p: g.p, q: g.q, cls: g.cls, events: u.ids.length, ids: u.ids.slice(0, 300), name: u.name ?? null } };
      });
      return {
        summary: { ...base, params: p, checks, moran, classes, units: units.length, correction: p.fdr ? "Benjamini–Hochberg FDR" : "none (uncorrected p-values)" },
        geojson: { type: "FeatureCollection", features: features.filter((ft) => ft.properties.cls !== "ns" || (ft.properties.events as number) > 0) },
        table: features.filter((ft) => String(ft.properties.cls).startsWith("hot")).map((ft) => ({ unit: ft.properties.unitId, name: ft.properties.name, events: ft.properties.events, z: ft.properties.z, q: ft.properties.q, class: ft.properties.cls })).sort((a, b) => (b.z as number) - (a.z as number)),
      };
    }
    case "dbscan": {
      const p = paramSchemas.dbscan.parse(rawParams ?? {});
      await progress(50, "Clustering");
      const pts = rows.map((r) => [r.x, r.y] as XY);
      const res = dbscan(pts, p.eps, p.minPts);
      const kd = kDistanceCurve(pts, p.minPts);
      const groups = new Map<number, number[]>();
      res.labels.forEach((l, i) => l >= 0 && (groups.get(l) ?? groups.set(l, []).get(l)!).push(i));
      const { convexHull } = await import("@/lib/geo/geometry");
      const table: Record<string, unknown>[] = [];
      const features: Feature[] = [];
      for (const [cid, idx] of groups) {
        const members = idx.map((i) => rows[i]);
        const sev: Record<string, number> = {};
        const cat: Record<string, number> = {};
        members.forEach((m) => {
          sev[m.severity] = (sev[m.severity] ?? 0) + 1;
          cat[m.category] = (cat[m.category] ?? 0) + 1;
        });
        const cx = members.reduce((a, m) => a + m.x, 0) / members.length;
        const cy = members.reduce((a, m) => a + m.y, 0) / members.length;
        const hull = convexHull(idx.map((i) => pts[i]));
        const dominant = Object.entries(cat).sort((a, b) => b[1] - a[1])[0][0];
        const row = { cluster: cid + 1, size: members.length, centroid: toLonLat([cx, cy]), dominantCategory: dominant, fatalSerious: (sev.fatal ?? 0) + (sev.serious ?? 0), severity: sev };
        table.push(row);
        const ring = hull.length >= 4 ? hull.map(toLonLat) : null;
        features.push({
          type: "Feature",
          geometry: ring ? { type: "Polygon", coordinates: [ring] } : { type: "Point", coordinates: toLonLat([cx, cy]) },
          properties: { cluster: cid + 1, size: members.length, dominantCategory: dominant, fatalSerious: row.fatalSerious, ids: members.slice(0, 300).map((m) => m.id) },
        });
      }
      table.sort((a, b) => (b.size as number) - (a.size as number));
      return { summary: { ...base, params: p, clusters: res.clusterCount, noise: res.noiseCount, noiseShare: rows.length ? res.noiseCount / rows.length : 0, corePoints: res.coreCount, kDistance: kd }, geojson: { type: "FeatureCollection", features }, table };
    }
    case "nearest": {
      const p = paramSchemas.nearest.parse(rawParams ?? {});
      await progress(50, "Assigning reports to nearest segment");
      const ids = rows.map((r) => r.id);
      const orig = ids.length ? await db.select({ id: accidents.id, lon: accidents.reportedLon, lat: accidents.reportedLat }).from(accidents).where(inArray(accidents.id, ids)) : [];
      const { toUtm } = await import("@/lib/geo/projection");
      const hist = new Array<number>(13).fill(0);
      let assigned = 0;
      const features: Feature[] = [];
      const perSeg = new Map<number, number>();
      for (const o of orig) {
        const xy = toUtm(o.lon, o.lat);
        const nn = net.grid.nearest(xy, p.maxDistance);
        if (nn) {
          assigned++;
          perSeg.set(nn.line.id, (perSeg.get(nn.line.id) ?? 0) + 1);
          hist[Math.min(12, Math.floor(nn.proj.distance / 5))]++;
          if (features.length < 4000) features.push({ type: "Feature", geometry: { type: "LineString", coordinates: [[r6(o.lon), r6(o.lat)], toLonLat(nn.proj.point)] }, properties: { id: o.id, distance: Math.round(nn.proj.distance * 10) / 10, segmentId: nn.line.id } });
        } else {
          hist[12]++;
          features.push({ type: "Feature", geometry: { type: "Point", coordinates: [r6(o.lon), r6(o.lat)] }, properties: { id: o.id, unassigned: true } });
        }
      }
      const d = features.filter((ft) => ft.properties.distance !== undefined).map((ft) => ft.properties.distance as number).sort((a, b) => a - b);
      return {
        summary: { ...base, params: p, assigned, unassigned: orig.length - assigned, assignedShare: orig.length ? assigned / orig.length : 0, medianDistance: d[Math.floor(d.length / 2)] ?? null, p95Distance: d[Math.floor(d.length * 0.95)] ?? null, histogram: hist.map((c, i) => ({ bin: i < 12 ? `${i * 5}–${i * 5 + 5} m` : `>60 m / unassigned`, count: c })), segmentsWithAssignments: perSeg.size },
        geojson: { type: "FeatureCollection", features },
        table: null,
      };
    }
    case "segments": {
      const p = paramSchemas.segments.parse(rawParams ?? {});
      await progress(50, "Aggregating by segment");
      const years = spanYears(rows, f);
      const agg = segmentAggregation(rows, net.segments, years);
      const features: Feature[] = agg.map((a) => ({ type: "Feature", geometry: { type: "LineString", coordinates: net.byId.get(a.id)!.geom }, properties: { ...a, value: p.metric === "count" ? a.n : p.metric === "epdo" ? a.epdo : a.densityKmYr } }));
      return {
        summary: { ...base, params: p, years, segments: agg.length, segmentsWithEvents: agg.filter((a) => a.n > 0).length, unassignedEvents: rows.filter((r) => !r.segmentId).length },
        geojson: { type: "FeatureCollection", features },
        table: [...agg].sort((a, b) => b.densityKmYr - a.densityKmYr).slice(0, 100),
      };
    }
    case "temporal": {
      await progress(60, "Aggregating temporally");
      return { summary: { ...base, timezone: CITY_TIMEZONE, ...temporalProfile(rows) }, geojson: null, table: null };
    }
    case "environment": {
      await progress(50, "Computing exposure");
      return { summary: { ...base, ...(await environmentComparison(rows, f, net.segments, spanYears(rows, f))) }, geojson: null, table: null };
    }
  }
}

export function segmentAggregation(rows: AccidentRow[], segments: { id: number; name: string; roadClass: string; lengthM: number; speedLimit: number; aadt: number | null }[], years: number) {
  const m = new Map<number, { n: number; epdo: number; fs: number }>();
  for (const r of rows) {
    if (!r.segmentId) continue;
    const a = m.get(r.segmentId) ?? { n: 0, epdo: 0, fs: 0 };
    a.n++;
    a.epdo += SEVERITIES.find((s) => s.code === r.severity)?.epdoWeight ?? 1;
    if (r.severity === "fatal" || r.severity === "serious") a.fs++;
    m.set(r.segmentId, a);
  }
  return segments.map((s) => {
    const a = m.get(s.id) ?? { n: 0, epdo: 0, fs: 0 };
    const [lo, hi] = poissonCI(a.n);
    const km = s.lengthM / 1000;
    return { id: s.id, name: s.name, roadClass: s.roadClass, lengthM: Math.round(s.lengthM), n: a.n, ciLow: Math.round(lo * 100) / 100, ciHigh: Math.round(hi * 100) / 100, fatalSerious: a.fs, epdo: a.epdo, densityKmYr: Math.round((a.n / km / years) * 100) / 100, epdoKmYr: Math.round((a.epdo / km / years) * 100) / 100, aadt: s.aadt };
  });
}

async function environmentComparison(rows: AccidentRow[], f: Filters, segments: { id: number; lengthM: number; lit: boolean; roadClass: string; speedLimit: number; aadt: number | null }[], years: number) {
  const dsId = await networkDatasetId();
  const from = f.from ? new Date(f.from) : new Date(rows[0]?.t ?? Date.now());
  const to = f.to ? new Date(f.to.length <= 10 ? `${f.to}T23:59:59Z` : f.to) : new Date(rows[rows.length - 1]?.t ?? Date.now());
  const obs = dsId
    ? await db
        .select({ t: environmentalObservations.observedAt, c: environmentalObservations.condition })
        .from(environmentalObservations)
        .where(and(eq(environmentalObservations.datasetId, dsId), gte(environmentalObservations.observedAt, from), lte(environmentalObservations.observedAt, to)))
    : [];
  const hourOk = (t: number) => {
    const p = localParts(t);
    const hOk = f.hourFrom === undefined || f.hourTo === undefined ? true : f.hourFrom <= f.hourTo ? p.hour >= f.hourFrom && p.hour <= f.hourTo : p.hour >= f.hourFrom || p.hour <= f.hourTo;
    const wOk = !f.weekdays?.length || f.weekdays.includes(p.weekday);
    return hOk && wOk;
  };
  const wxExp: Record<string, number> = {};
  const lightExp: Record<string, number> = {};
  const net = await getNetwork();
  const [clon, clat] = net ? toLonLat([(net.extent.minX + net.extent.maxX) / 2, (net.extent.minY + net.extent.maxY) / 2]) : [15, 45];
  const filtered = f.hourFrom !== undefined || f.weekdays?.length;
  for (const o of obs) {
    const t = o.t.getTime();
    if (filtered && !hourOk(t)) continue;
    wxExp[o.c] = (wxExp[o.c] ?? 0) + 1;
    const l = lightCondition(t + 1800000, clat, clon);
    lightExp[l] = (lightExp[l] ?? 0) + 1;
  }
  const wxCount: Record<string, number> = {};
  const lightCount: Record<string, number> = {};
  for (const r of rows) {
    if (r.weather) wxCount[r.weather] = (wxCount[r.weather] ?? 0) + 1;
    if (r.light) lightCount[r.light] = (lightCount[r.light] ?? 0) + 1;
  }
  const segById = new Map(segments.map((s) => [s.id, s]));
  const roadCount: Record<string, Record<string, number>> = { lighting: {}, roadClass: {}, speed: {} };
  const roadExp: Record<string, Record<string, number>> = { lighting: {}, roadClass: {}, speed: {} };
  const mvkmExp: Record<string, number> = {};
  for (const s of segments) {
    const ky = (s.lengthM / 1000) * years;
    const keys = { lighting: s.lit ? "lit" : "unlit", roadClass: s.roadClass, speed: `${s.speedLimit} km/h` };
    (Object.keys(keys) as (keyof typeof keys)[]).forEach((k) => (roadExp[k][keys[k]] = (roadExp[k][keys[k]] ?? 0) + ky));
    if (s.aadt) mvkmExp[s.roadClass] = (mvkmExp[s.roadClass] ?? 0) + (ky * s.aadt * 365) / 1e6;
  }
  for (const r of rows) {
    const s = r.segmentId ? segById.get(r.segmentId) : undefined;
    if (!s) continue;
    const keys = { lighting: s.lit ? "lit" : "unlit", roadClass: s.roadClass, speed: `${s.speedLimit} km/h` };
    (Object.keys(keys) as (keyof typeof keys)[]).forEach((k) => (roadCount[k][keys[k]] = (roadCount[k][keys[k]] ?? 0) + 1));
  }
  const [ds] = dsId ? await db.select({ config: datasetSources.config }).from(datasetSources).where(eq(datasetSources.id, dsId)) : [];
  const injected = (ds?.config as { injectedEffects?: Record<string, unknown> } | undefined)?.injectedEffects ?? null;
  const darkNight = rows.filter((r) => r.light === "dark").length;
  return {
    years,
    weather: compareRates(wxCount, wxExp, "dry", 1000),
    weatherUnit: "events per 1,000 hours of condition",
    light: compareRates(lightCount, lightExp, "daylight", 1000),
    lighting: compareRates(roadCount.lighting, roadExp.lighting, "lit", 1),
    roadClass: compareRates(roadCount.roadClass, roadExp.roadClass, "local", 1),
    roadClassPerMVKm: compareRates(roadCount.roadClass, mvkmExp, "local", 1),
    speed: compareRates(roadCount.speed, roadExp.speed, "30 km/h", 1),
    roadUnit: "events per km·year",
    darkShare: rows.length ? darkNight / rows.length : 0,
    injectedEffects: injected,
    caveat:
      "Rate ratios are crude (unadjusted) associations. Light condition is confounded with hour-of-day and traffic volume; road attributes are confounded with exposure. Do not interpret as causal effects.",
  };
}

export async function computeRisk(filters: Filters, raw: unknown) {
  const cfgIn = riskSchema.parse(raw ?? {});
  const statuses = filters.statuses?.length ? filters.statuses : DEFAULT_ANALYSIS_STATUSES;
  const rows = await loadAccidents({ ...filters, statuses });
  const net = await getNetwork();
  if (!net) throw new ApiError(409, "No road network available");
  const years = spanYears(rows, filters);
  const cfg: RiskConfig = { ...cfgIn, years, seed: 2024 };
  const out = assessRisk(
    net.segments.map((s) => ({ id: s.id, name: s.name, roadClass: s.roadClass, lengthM: s.lengthM, speedLimit: s.speedLimit, lanes: s.lanes, lit: s.lit, aadt: s.aadt })),
    rows.filter((r) => r.segmentId).map((r) => ({ segmentId: r.segmentId as number, severity: r.severity, adverseWeather: !!r.weather && r.weather !== "dry", dark: r.light === "dark", pending: r.status === "reported" })),
    cfg,
  );
  const unassigned = rows.filter((r) => !r.segmentId).length;
  return { ...out, config: cfg, statuses, unassignedEvents: unassigned, syntheticData: rows.some((r) => r.isSynthetic), geometry: Object.fromEntries(net.segments.map((s) => [s.id, s.geom])) };
}

export async function quickCount() {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(accidents);
  return r.n;
}
