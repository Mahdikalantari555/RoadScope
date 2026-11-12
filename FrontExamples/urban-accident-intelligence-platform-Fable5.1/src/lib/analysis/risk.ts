import { db } from "@/db";
import { accidents, severityLevels } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { loadNetwork } from "@/lib/geo/loader";

export interface SegmentRisk {
  segmentId: number; roadClass: string; lengthM: number; aadt: number | null; speedLimit: number; lanes: number; sinuosity: number; maxDegree: number;
  n: number; nVerified: number; nRaw: number; density: number; epdo: number; ratePerMVKT: number | null;
  spfMu: number; ebExpected: number; ebWeight: number; psi: number; ebVar: number; ebCI: [number, number];
  geomHazard: number; envHazard: number; composite: number; rank: number;
  uncertainty: number; coverageFlags: string[];
}
export interface MCDAWeights { eb: number; severity: number; geometry: number; environment: number }
export const DEFAULT_WEIGHTS: MCDAWeights = { eb: 0.45, severity: 0.25, geometry: 0.15, environment: 0.15 };

/** Fit SPF μ = a·L_km·AADT^b per road class by log-linear least squares on segments with AADT>0. */
function fitSPF(rows: { n: number; aadt: number | null; lengthM: number }[]) {
  const pts = rows.filter((r) => r.aadt && r.aadt > 0).map((r) => ({ x: Math.log(r.aadt!), y: Math.log((r.n + 0.5) / (r.lengthM / 1000)) }));
  if (pts.length < 4) { const mean = rows.reduce((a, r) => a + r.n, 0) / Math.max(1, rows.reduce((a, r) => a + r.lengthM / 1000, 0)); return { a: Math.max(mean, 1e-3), b: 0, nFit: pts.length }; }
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let sxy = 0, sxx = 0; for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; }
  const b = sxx > 0 ? Math.max(0, Math.min(1.5, sxy / sxx)) : 0;
  const a = Math.exp(my - b * mx);
  return { a, b, nFit: pts.length };
}

export async function computeSegmentRisk(opts: { includeRaw: boolean; weights: MCDAWeights; sourceId?: number }) {
  const loaded = await loadNetwork(opts.sourceId);
  if (!loaded) return null;
  const { net, source } = loaded;
  const sevs = await db.select().from(severityLevels);
  const sevW = new Map(sevs.map((s) => [s.id, s.epdoWeight]));
  const statuses = opts.includeRaw ? ["verified", "raw", "flagged"] : ["verified"];
  const rows = await db.select({ segmentId: accidents.segmentId, severityId: accidents.severityId, status: accidents.status, weather: accidents.weather, lighting: accidents.lighting, credibility: accidents.credibility })
    .from(accidents).where(and(eq(accidents.sourceId, source.id), inArray(accidents.status, statuses), isNull(accidents.canonicalId)));
  const agg = new Map<number, { n: number; nv: number; nr: number; epdo: number; adverse: number }>();
  for (const r of rows) {
    if (!r.segmentId) continue;
    const a = agg.get(r.segmentId) ?? { n: 0, nv: 0, nr: 0, epdo: 0, adverse: 0 };
    const w = r.status === "verified" ? 1 : Math.max(0.2, r.credibility); // credibility-weighted VGI contribution
    a.n += w; if (r.status === "verified") a.nv++; else a.nr++;
    a.epdo += w * (sevW.get(r.severityId) ?? 1);
    if (r.weather !== "clear" || r.lighting === "dark") a.adverse += w;
    agg.set(r.segmentId, a);
  }
  const base = [...net.segments.values()].map((s) => {
    const a = agg.get(s.id) ?? { n: 0, nv: 0, nr: 0, epdo: 0, adverse: 0 };
    const maxDegree = Math.max(net.nodes.get(s.from)!.degree, net.nodes.get(s.to)!.degree);
    return { s, a, maxDegree };
  });
  // SPF per class + overdispersion by method of moments
  const classes = [...new Set(base.map((b) => b.s.roadClass))];
  const spf: Record<string, { a: number; b: number; phi: number; nFit: number }> = {};
  for (const c of classes) {
    const rowsC = base.filter((b) => b.s.roadClass === c).map((b) => ({ n: b.a.n, aadt: b.s.aadt, lengthM: b.s.length }));
    const f = fitSPF(rowsC);
    const mus = rowsC.map((r) => f.a * (r.lengthM / 1000) * Math.pow(r.aadt ?? medianAadt(rowsC), f.b));
    const mean = mus.reduce((x, y) => x + y, 0) / mus.length;
    const varN = rowsC.reduce((x, r) => x + (r.n - mean) ** 2, 0) / Math.max(1, rowsC.length - 1);
    const k = Math.max(0.05, (varN - mean) / (mean * mean || 1)); // NB dispersion
    spf[c] = { ...f, phi: 1 / k };
  }
  const maxEpdo = Math.max(1, ...base.map((b) => b.a.epdo));
  const out: SegmentRisk[] = base.map(({ s, a, maxDegree }) => {
    const f = spf[s.roadClass];
    const aadtUsed = s.aadt ?? medianAadt(base.filter((b) => b.s.roadClass === s.roadClass).map((b) => ({ aadt: b.s.aadt })));
    const mu = f.a * (s.length / 1000) * Math.pow(aadtUsed, f.b);
    const w = 1 / (1 + mu / f.phi);
    const eb = w * mu + (1 - w) * a.n;
    const ebVar = (1 - w) * eb;
    const periodDays = Number((source.params as { days?: number })?.days ?? 90);
    const mvkt = s.aadt ? (s.aadt * periodDays * (s.length / 1000)) / 1e6 : null;
    const geomHazard = Math.min(1, 0.35 * (s.sinuosity - 1) * 10 + 0.25 * (maxDegree >= 4 ? 1 : maxDegree === 3 ? 0.6 : 0.2) + 0.25 * (s.speedLimit >= 60 ? 1 : s.speedLimit >= 50 ? 0.6 : 0.3) + 0.15 * (s.lanes >= 4 ? 1 : 0.4));
    const envHazard = a.n > 0 ? a.adverse / a.n : 0;
    const flags: string[] = [];
    if (!s.aadt) flags.push("no_exposure");
    if (a.n < 3) flags.push("sparse");
    if (a.nr > a.nv) flags.push("vgi_dominated");
    const uncertainty = Math.min(1, 0.4 * (a.n < 3 ? 1 : a.n < 8 ? 0.5 : 0.15) + 0.3 * (s.aadt ? 0 : 1) + 0.3 * (a.n ? a.nr / a.n : 1));
    return {
      segmentId: s.id, roadClass: s.roadClass, lengthM: s.length, aadt: s.aadt, speedLimit: s.speedLimit, lanes: s.lanes, sinuosity: s.sinuosity, maxDegree,
      n: a.n, nVerified: a.nv, nRaw: a.nr, density: a.n / (s.length / 1000), epdo: a.epdo, ratePerMVKT: mvkt ? a.n / mvkt : null,
      spfMu: mu, ebExpected: eb, ebWeight: w, psi: eb - mu, ebVar, ebCI: [Math.max(0, eb - 1.96 * Math.sqrt(ebVar)), eb + 1.96 * Math.sqrt(ebVar)],
      geomHazard, envHazard, composite: 0, rank: 0, uncertainty, coverageFlags: flags, _epdoNorm: a.epdo / maxEpdo,
    } as SegmentRisk & { _epdoNorm: number };
  });
  const maxEB = Math.max(1e-9, ...out.map((o) => o.ebExpected));
  const W = opts.weights; const sw = W.eb + W.severity + W.geometry + W.environment || 1;
  for (const o of out) {
    const e = o as SegmentRisk & { _epdoNorm: number };
    o.composite = (W.eb * (o.ebExpected / maxEB) + W.severity * e._epdoNorm + W.geometry * o.geomHazard + W.environment * o.envHazard) / sw;
    delete (e as Partial<typeof e>)._epdoNorm;
  }
  out.sort((x, y) => y.composite - x.composite).forEach((o, i) => (o.rank = i + 1));
  return { source: { id: source.id, name: source.name, kind: source.kind }, spf, segments: out, note: "Composite is a heuristic multi-criteria priority index — NOT a calibrated crash probability." };
}
function medianAadt(rows: { aadt: number | null }[]) { const v = rows.map((r) => r.aadt).filter((x): x is number => !!x).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 1000; }
