import { RoadNetwork, projectOnPolyline, dist, type XY, type NetPoint } from "@/lib/geo/network";

export interface SnapCandidate { segmentId: number; roadClass: string; m: number; distanceM: number; point: XY; likelihood: number; posterior: number; nearJunctionNodeId: number | null }

/** Road-class prior: citizens more often report on higher-order roads; also reflects crash exposure. */
const CLASS_PRIOR: Record<string, number> = { arterial: 1.0, collector: 0.8, local: 0.55 };

/**
 * Probabilistic topological map-matching.
 * likelihood(c) = N(d_perp | 0, σ²) · prior(roadClass) · topo(c)
 *  - σ = max(reporter uncertainty radius, 8 m)
 *  - topo(c): when the observation lies within 20 m of a junction of degree ≥ 3, every incident leg is an
 *    admissible hypothesis; the candidate set is extended to all legs and the posterior is normalised over them
 *    (avoids naive nearest-neighbour bias at multi-leg junctions / parallel corridors).
 */
export function mapMatch(net: RoadNetwork, p: XY, sigmaM: number, searchRadiusM = 80): SnapCandidate[] {
  const sigma = Math.max(sigmaM, 8);
  const cands: SnapCandidate[] = [];
  const nearSegs = net.segmentsNear(p, searchRadiusM);
  const incidentLegs = new Set<number>();
  let junction: number | null = null;
  for (const n of net.nodes.values()) if (n.degree >= 3 && dist(n.xy, p) <= 20) { junction = n.id; for (const e of net.adj.get(n.id) ?? []) incidentLegs.add(e.seg); }
  for (const s of nearSegs) {
    const pr = projectOnPolyline(s.coords, p);
    if (pr.d > searchRadiusM && !incidentLegs.has(s.id)) continue;
    const gauss = Math.exp(-(pr.d * pr.d) / (2 * sigma * sigma));
    const topo = incidentLegs.has(s.id) ? 1.0 : junction !== null ? 0.6 : 1.0;
    const like = gauss * (CLASS_PRIOR[s.roadClass] ?? 0.7) * topo;
    cands.push({ segmentId: s.id, roadClass: s.roadClass, m: pr.m, distanceM: pr.d, point: pr.pt, likelihood: like, posterior: 0, nearJunctionNodeId: incidentLegs.has(s.id) ? junction : null });
  }
  const Z = cands.reduce((a, c) => a + c.likelihood, 0);
  for (const c of cands) c.posterior = Z > 0 ? c.likelihood / Z : 0;
  cands.sort((a, b) => b.posterior - a.posterior);
  return cands.slice(0, 6);
}

export interface ConflationHit { id: number; dNet: number; dtMin: number; kernel: number }

/** Spatiotemporal network decay kernel κ = exp(-d/δd)·exp(-|Δt|/δt), evaluated within hard windows. */
export function conflationCandidates(
  net: RoadNetwork, p: NetPoint, t: Date,
  others: { id: number; p: NetPoint; t: Date }[],
  dMax: number, dtMaxMin: number, deltaD = dMax / 2, deltaT = dtMaxMin / 2,
): ConflationHit[] {
  const inTime = others.filter((o) => Math.abs(o.t.getTime() - t.getTime()) / 60000 <= dtMaxMin);
  const dmap = net.pointDistancesTo(p, inTime.map((o) => ({ key: o.id, p: o.p })), dMax);
  const out: ConflationHit[] = [];
  for (const o of inTime) {
    const d = dmap.get(o.id); if (d === undefined) continue;
    const dt = Math.abs(o.t.getTime() - t.getTime()) / 60000;
    out.push({ id: o.id, dNet: d, dtMin: dt, kernel: Math.exp(-d / deltaD) * Math.exp(-dt / deltaT) });
  }
  return out.sort((a, b) => b.kernel - a.kernel);
}

/**
 * Composite VGI credibility ∈ [0,1]:
 *  0.4·(1−e^{−0.7(w−1)}) witness agreement  + 0.3·snap posterior  + 0.3·attribute consistency
 */
export function credibilityScore(witnessCount: number, snapPosterior: number, consistency: number) {
  const w = 1 - Math.exp(-0.7 * Math.max(0, witnessCount - 1));
  return Math.max(0, Math.min(1, 0.4 * w + 0.3 * snapPosterior + 0.3 * consistency));
}

/** Attribute consistency between a report and a canonical incident (0..1) */
export function attributeConsistency(a: { categoryId: number; severityRank: number; vehicles: number }, b: { categoryId: number; severityRank: number; vehicles: number }) {
  let s = 0;
  s += a.categoryId === b.categoryId ? 0.5 : 0.15;
  s += 0.3 * Math.max(0, 1 - Math.abs(a.severityRank - b.severityRank) / 3);
  s += 0.2 * Math.max(0, 1 - Math.abs(a.vehicles - b.vehicles) / 3);
  return s;
}
