import { db } from "@/db";
import {
  accidentCategories, accidents, auditLogs, datasetSources, environmentalObservations, roadLixels, roadNodes, roadSegments, severityLevels, trafficObservations, users,
} from "@/db/schema";
import { eq, inArray, notInArray } from "drizzle-orm";
import { RoadNetwork, lixelize, makeProjection, polylineLength, dist, type XY } from "@/lib/geo/network";
import { mapMatch, credibilityScore } from "@/lib/analysis/mapmatch";
import { invalidateNetworkCache } from "@/lib/geo/loader";

export type Scenario = "uniform" | "intersection" | "diurnal" | "complex";
export interface SimParams {
  scenario: Scenario; seed: number; lixelResolution: number; gridCols: number; gridRows: number; spacingM: number;
  days: number; expectedEvents: number; positionalSigmaM: number; falseAlarmRate: number; lagMeanMin: number;
  intersectionAlpha: number; preVerifiedFraction: number;
}
export const DEFAULT_PARAMS: SimParams = {
  scenario: "complex", seed: 42, lixelResolution: 25, gridCols: 9, gridRows: 8, spacingM: 230, days: 90,
  expectedEvents: 650, positionalSigmaM: 12, falseAlarmRate: 0.06, lagMeanMin: 25, intersectionAlpha: 3.5, preVerifiedFraction: 0.55,
};
const ORIGIN: XY = [8.5417, 47.3769]; // nominal geographic anchor (synthetic network; basemap is contextual only)

// ---------- seeded RNG ----------
export function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => { const u1 = Math.max(u(), 1e-12), u2 = u(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
  const poisson = (lam: number) => { if (lam <= 0) return 0; if (lam > 50) return Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss())); const L = Math.exp(-lam); let k = 0, p = 1; do { k++; p *= u(); } while (p > L); return k - 1; };
  const pick = <T,>(arr: T[]) => arr[Math.floor(u() * arr.length)];
  const expo = (mean: number) => -Math.log(Math.max(u(), 1e-12)) * mean;
  return { u, gauss, poisson, pick, expo };
}

// ---------- ground-truth temporal profile ----------
export function temporalProfile(scenario: Scenario, t: Date): number {
  if (scenario === "uniform" || scenario === "intersection") return 1;
  const h = t.getUTCHours() + t.getUTCMinutes() / 60, dow = t.getUTCDay();
  const rush = 1 + 1.8 * Math.exp(-((h - 8) ** 2) / (2 * 1.2 ** 2)) + 2.2 * Math.exp(-((h - 17.5) ** 2) / (2 * 1.5 ** 2));
  const night = h < 5 ? 0.35 : 1;
  const weekend = dow === 0 || dow === 6 ? 0.65 : 1;
  const seasonal = scenario === "complex" ? 1 + 0.25 * Math.sin((2 * Math.PI * t.getTime()) / (365.25 * 86400e3)) : 1;
  return rush * night * weekend * seasonal;
}
const WEATHER = ["clear", "cloudy", "rain", "fog", "snow"] as const;
const WEATHER_RISK: Record<string, number> = { clear: 1, cloudy: 1.05, rain: 1.6, fog: 1.9, snow: 2.3 };
const CLASS_RISK: Record<string, number> = { arterial: 1.0, collector: 0.75, local: 0.45 };
const CATEGORIES = [["rear_end", "Rear-end collision"], ["side_impact", "Side impact / angle"], ["head_on", "Head-on collision"], ["pedestrian", "Pedestrian struck"], ["cyclist", "Cyclist involved"], ["single_vehicle", "Single vehicle / fixed object"], ["sideswipe", "Sideswipe"], ["rollover", "Rollover"]];
const SEVERITIES = [["pdo", "Property damage only", 1, 1], ["minor", "Minor injury", 2, 3.5], ["serious", "Serious injury", 3, 25], ["fatal", "Fatal", 4, 150]] as const;

export async function ensureLookups() {
  for (const [code, label] of CATEGORIES) await db.insert(accidentCategories).values({ code, label }).onConflictDoNothing();
  for (const [code, label, rank, w] of SEVERITIES) await db.insert(severityLevels).values({ code, label, rank, epdoWeight: w }).onConflictDoNothing();
  const existing = await db.select().from(users);
  if (existing.length === 0) {
    await db.insert(users).values([
      { name: "Simulation Engine", role: "admin" }, { name: "Citizen (anonymous)", role: "citizen" },
      { name: "Data Steward", role: "steward" }, { name: "GIScience Researcher", role: "researcher" }, { name: "Safety Engineer", role: "engineer" },
    ]);
  }
}

export async function runSimulation(input: Partial<SimParams>) {
  const P: SimParams = { ...DEFAULT_PARAMS, ...input };
  const r = rng(P.seed);
  const proj = makeProjection(ORIGIN[0], ORIGIN[1]);
  await ensureLookups();
  const cats = await db.select().from(accidentCategories);
  const sevs = await db.select().from(severityLevels);
  const sevByCode = Object.fromEntries(sevs.map((s) => [s.code, s]));
  const [simUser] = await db.select().from(users).where(eq(users.role, "admin"));
  const [citizen] = await db.select().from(users).where(eq(users.role, "citizen"));
  const [steward] = await db.select().from(users).where(eq(users.role, "steward"));

  // retire previous sources (keep 2 most recent for comparison)
  await db.update(datasetSources).set({ isActive: false });
  const olds = await db.select({ id: datasetSources.id }).from(datasetSources);
  if (olds.length > 2) { const keep = olds.slice(-2).map((o) => o.id); await db.delete(datasetSources).where(notInArray(datasetSources.id, keep)); }

  const [source] = await db.insert(datasetSources).values({
    name: `SYNTHETIC · ${P.scenario} · seed ${P.seed}`, kind: "synthetic", scenario: P.scenario, seed: P.seed,
    params: P as unknown as Record<string, unknown>, originLon: ORIGIN[0], originLat: ORIGIN[1], isActive: true,
  }).returning();

  // ---------- 1. Topological network ----------
  const w = (P.gridCols - 1) * P.spacingM, h = (P.gridRows - 1) * P.spacingM;
  const gridNodes: (XY | null)[][] = [];
  for (let i = 0; i < P.gridCols; i++) { gridNodes.push([]); for (let j = 0; j < P.gridRows; j++) {
    const drop = r.u() < 0.07 && i > 0 && j > 0 && i < P.gridCols - 1 && j < P.gridRows - 1;
    gridNodes[i].push(drop ? null : [i * P.spacingM - w / 2 + r.gauss() * 18, j * P.spacingM - h / 2 + r.gauss() * 18]);
  } }
  const nodeRows = await db.insert(roadNodes).values(
    gridNodes.flatMap((col) => col.filter((n): n is XY => !!n).map((xy) => { const [lon, lat] = proj.toLonLat(xy[0], xy[1]); return { sourceId: source.id, lon, lat, x: xy[0], y: xy[1] }; })),
  ).returning();
  const nodeIdAt = new Map<string, number>();
  { let k = 0; for (let i = 0; i < P.gridCols; i++) for (let j = 0; j < P.gridRows; j++) if (gridNodes[i][j]) nodeIdAt.set(`${i},${j}`, nodeRows[k++].id); }
  const nodeXY = new Map(nodeRows.map((n) => [n.id, [n.x, n.y] as XY]));

  const arterialCols = new Set<number>(), arterialRows = new Set<number>();
  for (let i = 1; i < P.gridCols; i += 3) arterialCols.add(i);
  for (let j = 1; j < P.gridRows; j += 3) arterialRows.add(j);
  const segValues: (typeof roadSegments.$inferInsert)[] = [];
  const addEdge = (a: number, b: number, cls: string) => {
    const A = nodeXY.get(a)!, B = nodeXY.get(b)!;
    const coords: XY[] = [A];
    const n = cls === "local" && r.u() < 0.5 ? 2 : 1;
    for (let k = 1; k < n + 1 && n > 1; k++) { const t = k / (n + 1 - 1 + 1); const perp = r.gauss() * 14; const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy); coords.push([A[0] + t * dx - (dy / L) * perp, A[1] + t * dy + (dx / L) * perp]); }
    coords.push(B);
    const L = polylineLength(coords);
    const aadtBase = cls === "arterial" ? 14000 + r.u() * 16000 : cls === "collector" ? 4500 + r.u() * 7000 : 400 + r.u() * 2400;
    const hasAadt = r.u() > 0.14; // 14 % of segments lack exposure data → epistemic uncertainty
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of coords) { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); }
    segValues.push({
      sourceId: source.id, fromNodeId: a, toNodeId: b, roadClass: cls, speedLimit: cls === "arterial" ? 60 : cls === "collector" ? 50 : 30,
      lanes: cls === "arterial" ? 4 : cls === "collector" ? 2 : 2, oneway: cls === "local" && r.u() < 0.2, lengthM: L, sinuosity: L / dist(A, B),
      aadt: hasAadt ? Math.round(aadtBase) : null, coordsLonLat: coords.map((c) => proj.toLonLat(c[0], c[1])), coordsXY: coords, minX, minY, maxX, maxY,
    });
  };
  for (let i = 0; i < P.gridCols; i++) for (let j = 0; j < P.gridRows; j++) {
    const a = nodeIdAt.get(`${i},${j}`); if (!a) continue;
    const right = nodeIdAt.get(`${i + 1},${j}`), up = nodeIdAt.get(`${i},${j + 1}`);
    if (right && !(r.u() < 0.08)) addEdge(a, right, arterialRows.has(j) ? "arterial" : (j % 3 === 0 ? "collector" : "local"));
    if (up && !(r.u() < 0.08)) addEdge(a, up, arterialCols.has(i) ? "arterial" : (i % 3 === 0 ? "collector" : "local"));
  }
  const segRows = await db.insert(roadSegments).values(segValues).returning();
  // node degrees
  const deg = new Map<number, number>();
  for (const s of segRows) { deg.set(s.fromNodeId, (deg.get(s.fromNodeId) ?? 0) + 1); deg.set(s.toNodeId, (deg.get(s.toNodeId) ?? 0) + 1); }
  for (const [id, d] of deg) await db.update(roadNodes).set({ degree: d }).where(eq(roadNodes.id, id));

  // ---------- 2. Lixelization + ground-truth spatial intensity ----------
  // corridor shock for complex scenario: one arterial corridor with elevated risk
  const corridorSeg = P.scenario === "complex" ? r.pick(segRows.filter((s) => s.roadClass === "arterial")) : null;
  const corridorXY = corridorSeg ? corridorSeg.coordsXY[0] : null;
  const spatialRate = (s: typeof segRows[number], m: number, mid: XY) => {
    let base = P.scenario === "uniform" ? 1 : CLASS_RISK[s.roadClass];
    if (P.scenario === "complex" && s.aadt) base *= Math.pow(s.aadt / 8000, 0.6);
    const dInt = Math.min(m, s.lengthM - m);
    const alpha = P.scenario === "uniform" ? 0 : P.scenario === "intersection" ? P.intersectionAlpha * 1.4 : P.intersectionAlpha;
    const degAtEnd = Math.max(deg.get(s.fromNodeId) ?? 1, deg.get(s.toNodeId) ?? 1);
    const inter = 1 + alpha * (degAtEnd >= 3 ? 1 : 0.4) * Math.exp(-(dInt * dInt) / (2 * 30 * 30));
    const corridor = corridorXY ? 1 + 2.5 * Math.exp(-(dist(mid, corridorXY) ** 2) / (2 * 260 * 260)) : 1;
    const sinu = P.scenario === "complex" ? 1 + 2 * (s.sinuosity - 1) : 1;
    return base * inter * corridor * sinu;
  };
  const lixelValues: (typeof roadLixels.$inferInsert)[] = [];
  const lixelRate: number[] = [];
  for (const s of segRows) {
    for (const l of lixelize(s.coordsXY, s.lengthM, P.lixelResolution)) {
      const rate = spatialRate(s, (l.mStart + l.mEnd) / 2, l.mid);
      lixelRate.push(rate);
      const [midLon, midLat] = proj.toLonLat(l.mid[0], l.mid[1]);
      lixelValues.push({ sourceId: source.id, segmentId: s.id, idx: l.idx, mStart: l.mStart, mEnd: l.mEnd, lengthM: l.length, midLon, midLat, midX: l.mid[0], midY: l.mid[1], coordsLonLat: l.coords.map((c) => proj.toLonLat(c[0], c[1])), trueIntensity: 0 });
    }
  }
  const mass = lixelValues.reduce((a, l, i) => a + lixelRate[i] * l.lengthM, 0);
  const scale = P.expectedEvents / mass; // λ normalised so that E[N] = expectedEvents over the period
  lixelValues.forEach((l, i) => { l.trueIntensity = lixelRate[i] * scale; });
  const lixelRows: (typeof roadLixels.$inferSelect)[] = [];
  for (let i = 0; i < lixelValues.length; i += 500) lixelRows.push(...(await db.insert(roadLixels).values(lixelValues.slice(i, i + 500)).returning()));

  // ---------- 3. Environmental covariate series (hourly Markov weather) ----------
  const t0 = Date.now() - P.days * 86400e3;
  const hours = P.days * 24;
  const weatherAt: string[] = []; let wstate = 0;
  const envValues: (typeof environmentalObservations.$inferInsert)[] = [];
  for (let k = 0; k < hours; k++) {
    if (r.u() < 0.12) wstate = r.u() < 0.55 ? 0 : r.u() < 0.5 ? 1 : r.u() < 0.6 ? 2 : r.u() < 0.6 ? 3 : 4;
    const t = new Date(t0 + k * 3600e3); const hr = t.getUTCHours();
    const weather = WEATHER[wstate]; weatherAt.push(weather);
    envValues.push({ sourceId: source.id, observedAt: t, weather, temperatureC: 8 + 8 * Math.sin((2 * Math.PI * (hr - 9)) / 24) + r.gauss() * 2, precipitationMm: weather === "rain" ? r.expo(2) : weather === "snow" ? r.expo(1) : 0, lighting: hr >= 7 && hr < 19 ? "daylight" : hr === 6 || hr === 19 ? "dusk_dawn" : "dark" });
  }
  for (let i = 0; i < envValues.length; i += 500) await db.insert(environmentalObservations).values(envValues.slice(i, i + 500));
  const weatherFor = (t: Date) => weatherAt[Math.min(hours - 1, Math.max(0, Math.floor((t.getTime() - t0) / 3600e3)))];
  const lightingFor = (t: Date) => { const hr = t.getUTCHours(); return hr >= 7 && hr < 19 ? "daylight" : hr === 6 || hr === 19 ? "dusk_dawn" : "dark"; };

  // ---------- 4. Point-process realisation: Poisson count per lixel, thinning in time ----------
  const net = new RoadNetwork(nodeRows.map((n) => ({ id: n.id, xy: [n.x, n.y], degree: 0 })), segRows.map((s) => ({ id: s.id, from: s.fromNodeId, to: s.toNodeId, length: s.lengthM, coords: s.coordsXY, roadClass: s.roadClass, aadt: s.aadt, speedLimit: s.speedLimit, lanes: s.lanes, sinuosity: s.sinuosity })), lixelRows.map((l) => ({ id: l.id, segmentId: l.segmentId, idx: l.idx, mStart: l.mStart, mEnd: l.mEnd, length: l.lengthM, mid: [l.midX, l.midY] })));
  const segById = new Map(segRows.map((s) => [s.id, s]));
  const tempMax = 6.5; // upper bound of temporal × weather profile for thinning
  const sampleTime = (): Date => { for (let k = 0; k < 500; k++) { const t = new Date(t0 + r.u() * P.days * 86400e3); const f = temporalProfile(P.scenario, t) * (P.scenario === "complex" ? WEATHER_RISK[weatherFor(t)] : 1); if (r.u() * tempMax < f) return t; } return new Date(t0 + r.u() * P.days * 86400e3); };
  const sampleSeverity = (s: typeof segRows[number]) => { const u = r.u(); const bump = s.speedLimit >= 60 ? 1.5 : s.speedLimit >= 50 ? 1.15 : 0.8; const pF = 0.012 * bump, pS = 0.08 * bump, pM = 0.33; return u < pF ? "fatal" : u < pF + pS ? "serious" : u < pF + pS + pM ? "minor" : "pdo"; };

  const accValues: (typeof accidents.$inferInsert)[] = [];
  let trueEvents = 0;
  const pushReport = (seg: typeof segRows[number], m: number, t: Date, sevCode: string, catId: number, key: string | null, falseAlarm: boolean, witnessIndex: number, vehicles: number, pedestrians: number) => {
    const onRoad = net.lixelAt(seg.id, m);
    const truePt = (() => { let acc = 0; const c = seg.coordsXY; for (let i = 1; i < c.length; i++) { const d = dist(c[i - 1], c[i]); if (acc + d >= m) { const tt = d ? (m - acc) / d : 0; return [c[i - 1][0] + tt * (c[i][0] - c[i - 1][0]), c[i - 1][1] + tt * (c[i][1] - c[i - 1][1])] as XY; } acc += d; } return c[c.length - 1]; })();
    const sigma = P.positionalSigmaM * (0.6 + r.u() * 0.9);
    const raw: XY = [truePt[0] + r.gauss() * sigma, truePt[1] + r.gauss() * sigma];
    const unc = r.pick([10, 15, 25, 50, 100]);
    const cands = mapMatch(net, raw, unc);
    const best = cands[0];
    const reportedAt = new Date(t.getTime() + r.expo(P.lagMeanMin) * 60e3);
    const [rawLon, rawLat] = proj.toLonLat(raw[0], raw[1]);
    const snapLL = best ? proj.toLonLat(best.point[0], best.point[1]) : null;
    const lix = best ? net.lixelAt(best.segmentId, best.m) : undefined;
    const preVerified = !falseAlarm && witnessIndex === 0 && r.u() < P.preVerifiedFraction;
    const cred = credibilityScore(1, best?.posterior ?? 0, 0.7 + r.u() * 0.3);
    accValues.push({
      sourceId: source.id, reporterId: citizen.id, categoryId: catId, severityId: sevByCode[sevCode].id, status: preVerified ? "verified" : "raw", isSynthetic: true,
      rawLon, rawLat, rawX: raw[0], rawY: raw[1], uncertaintyRadiusM: unc,
      snapLon: snapLL?.[0] ?? null, snapLat: snapLL?.[1] ?? null, snapX: best?.point[0] ?? null, snapY: best?.point[1] ?? null,
      segmentId: best?.segmentId ?? null, lixelId: lix?.id ?? null, offsetM: best?.m ?? null, snapDistanceM: best?.distanceM ?? null, snapPosterior: best?.posterior ?? null,
      snapCandidates: cands.map((c) => ({ segmentId: c.segmentId, m: +c.m.toFixed(1), distanceM: +c.distanceM.toFixed(1), posterior: +c.posterior.toFixed(3), roadClass: c.roadClass })),
      occurredAt: t, reportedAt, vehicles, pedestrians, emergencyPresent: sevCode === "serious" || sevCode === "fatal" ? r.u() < 0.9 : r.u() < 0.3,
      weather: weatherFor(t), lighting: lightingFor(t), description: falseAlarm ? "Possible incident seen from distance" : `Citizen report (${sevCode})`,
      witnessCount: 1, credibility: preVerified ? Math.max(cred, 0.75) : cred, trueEventKey: key, isFalseAlarm: falseAlarm,
    });
    void onRoad;
  };
  lixelRows.forEach((l, i) => {
    const n = r.poisson(lixelValues[i].trueIntensity! * l.lengthM);
    const seg = segById.get(l.segmentId)!;
    for (let k = 0; k < n; k++) {
      trueEvents++;
      const m = l.mStart + r.u() * l.lengthM; const t = sampleTime(); const sev = sampleSeverity(seg);
      const cat = r.pick(cats); const key = `${source.id}-${l.id}-${k}`;
      const vehicles = cat.code === "pedestrian" || cat.code === "cyclist" || cat.code === "single_vehicle" ? 1 : 1 + Math.floor(r.u() * 2.3);
      const peds = cat.code === "pedestrian" ? 1 : 0;
      const witnesses = 1 + (sev === "serious" || sev === "fatal" ? r.poisson(2.2) : sev === "minor" ? r.poisson(0.5) : r.poisson(0.15));
      for (let wi = 0; wi < witnesses; wi++) pushReport(seg, m, new Date(t.getTime() + (wi ? r.gauss() * 4 * 60e3 : 0)), sev, cat.id, key, false, wi, vehicles, peds);
    }
  });
  const nFalse = r.poisson(P.falseAlarmRate * trueEvents);
  for (let k = 0; k < nFalse; k++) { const l = r.pick(lixelRows); const seg = segById.get(l.segmentId)!; pushReport(seg, l.mStart + r.u() * l.lengthM, sampleTime(), "pdo", r.pick(cats).id, null, true, 1, 1, 0); }
  for (let i = 0; i < accValues.length; i += 400) await db.insert(accidents).values(accValues.slice(i, i + 400));

  // ---------- 5. Traffic exposure observations ----------
  const traffic = segRows.filter((s) => s.aadt).map((s) => ({ segmentId: s.id, observedAt: new Date(t0 + r.u() * P.days * 86400e3), aadt: Math.round(s.aadt! * (0.9 + r.u() * 0.2)), meanSpeedKmh: s.speedLimit * (0.75 + r.u() * 0.3) }));
  if (traffic.length) await db.insert(trafficObservations).values(traffic);

  await db.insert(auditLogs).values({ actorId: simUser?.id, entity: "dataset_sources", entityId: source.id, action: "simulate", details: { params: P, trueEvents, reports: accValues.length, falseAlarms: nFalse, lixels: lixelRows.length, segments: segRows.length, nodes: nodeRows.length, stewardId: steward?.id } });
  invalidateNetworkCache();
  return { sourceId: source.id, trueEvents, reports: accValues.length, falseAlarms: nFalse, lixels: lixelRows.length, segments: segRows.length, nodes: nodeRows.length };
}

export async function sourceSummary(sourceId: number) {
  const [lix] = await db.select({ id: roadLixels.id }).from(roadLixels).where(eq(roadLixels.sourceId, sourceId)).limit(1);
  return { hasLixels: !!lix };
}
export { inArray };
