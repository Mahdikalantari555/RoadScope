import { db } from "@/db";
import { accidents, auditLogs } from "@/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { loadNetwork } from "@/lib/geo/loader";
import { conflationCandidates } from "@/lib/analysis/mapmatch";

export const dynamic = "force-dynamic";

/** Triage queue: spatiotemporal network duplicate clusters + macro VGI quality diagnostics. */
export async function GET(req: Request) {
  const loaded = await loadNetwork();
  if (!loaded) return Response.json({ queue: [], clusters: [], diagnostics: null });
  const sp = new URL(req.url).searchParams;
  const dMax = Number(sp.get("dMax") ?? 150), dtMin = Number(sp.get("dtMin") ?? 60), limit = Math.min(600, Number(sp.get("limit") ?? 300));
  const { net, source } = loaded;
  const all = await db.select().from(accidents).where(and(eq(accidents.sourceId, source.id), isNull(accidents.canonicalId), inArray(accidents.status, ["raw", "verified", "flagged"])));
  const pending = all.filter((a) => a.status === "raw" || a.status === "flagged").sort((a, b) => b.reportedAt.getTime() - a.reportedAt.getTime()).slice(0, limit);
  const others = all.filter((r) => r.segmentId && r.offsetM !== null).map((r) => ({ id: r.id, p: { segmentId: r.segmentId!, m: r.offsetM! }, t: r.occurredAt }));
  // union-find over conflation hits
  const parent = new Map<number, number>(); const find = (x: number): number => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x)!)!); x = parent.get(x)!; } return x; };
  const union = (a: number, b: number) => { parent.set(find(a), find(b)); };
  for (const a of all) parent.set(a.id, a.id);
  const hitsById = new Map<number, { id: number; dNet: number; dtMin: number; kernel: number }[]>();
  for (const a of pending) {
    if (!a.segmentId || a.offsetM === null) continue;
    const hits = conflationCandidates(net, { segmentId: a.segmentId, m: a.offsetM }, a.occurredAt, others.filter((o) => o.id !== a.id), dMax, dtMin);
    hitsById.set(a.id, hits.slice(0, 5));
    for (const h of hits) if (h.kernel > 0.15) union(a.id, h.id);
  }
  const groups = new Map<number, number[]>();
  for (const a of all) { const r = find(a.id); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(a.id); }
  const byId = new Map(all.map((a) => [a.id, a]));
  const clusters = [...groups.values()].filter((g) => g.length > 1 && g.some((id) => byId.get(id)!.status !== "verified")).map((g) => {
    const members = g.map((id) => byId.get(id)!);
    const canonical = members.slice().sort((x, y) => (y.status === "verified" ? 1 : 0) - (x.status === "verified" ? 1 : 0) || y.credibility - x.credibility)[0];
    return { canonicalId: canonical.id, size: g.length, memberIds: g, members: members.map((m) => ({ id: m.id, status: m.status, severityId: m.severityId, categoryId: m.categoryId, occurredAt: m.occurredAt, credibility: m.credibility, witnessCount: m.witnessCount, snapDistanceM: m.snapDistanceM, lon: m.snapLon ?? m.rawLon, lat: m.snapLat ?? m.rawLat })) };
  }).sort((a, b) => b.size - a.size);

  const queue = pending.map((a) => ({ id: a.id, status: a.status, severityId: a.severityId, categoryId: a.categoryId, occurredAt: a.occurredAt, reportedAt: a.reportedAt, lagMin: (a.reportedAt.getTime() - a.occurredAt.getTime()) / 60000, snapDistanceM: a.snapDistanceM, snapPosterior: a.snapPosterior, uncertaintyRadiusM: a.uncertaintyRadiusM, credibility: a.credibility, witnessCount: a.witnessCount, segmentId: a.segmentId, offsetM: a.offsetM, isSynthetic: a.isSynthetic, description: a.description, candidates: a.snapCandidates, duplicates: hitsById.get(a.id) ?? [], rawLon: a.rawLon, rawLat: a.rawLat, lon: a.snapLon ?? a.rawLon, lat: a.snapLat ?? a.rawLat, weather: a.weather, lighting: a.lighting, vehicles: a.vehicles, pedestrians: a.pedestrians }));

  // diagnostics over the whole dataset (including rejected/merged)
  const full = await db.select({ status: accidents.status, snap: accidents.snapDistanceM, lag: accidents.reportedAt, occ: accidents.occurredAt, syn: accidents.isSynthetic, post: accidents.snapPosterior, cred: accidents.credibility, wc: accidents.witnessCount }).from(accidents).where(eq(accidents.sourceId, source.id));
  const hist = (vals: number[], edges: number[]) => edges.map((e, i) => ({ bin: i === edges.length - 1 ? `≥${e}` : `${e}–${edges[i + 1]}`, n: vals.filter((v) => v >= e && (i === edges.length - 1 || v < edges[i + 1])).length }));
  const snapVals = full.map((f) => f.snap ?? 0), lagVals = full.map((f) => (f.lag.getTime() - f.occ.getTime()) / 60000);
  const statusCounts: Record<string, number> = {}; for (const f of full) statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
  const audit = await db.select().from(auditLogs).orderBy(desc(auditLogs.id)).limit(25);
  const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  return Response.json({
    source: { id: source.id, name: source.name, kind: source.kind }, window: { dMaxM: dMax, dtMin }, queue, clusters,
    diagnostics: {
      total: full.length, statusCounts, synthetic: full.filter((f) => f.syn).length, empirical: full.filter((f) => !f.syn).length,
      rejectionRate: (statusCounts.rejected ?? 0) / Math.max(1, full.length), mergeRate: (statusCounts.merged ?? 0) / Math.max(1, full.length),
      snapHist: hist(snapVals, [0, 5, 10, 15, 20, 30, 45, 60]), lagHist: hist(lagVals, [0, 5, 15, 30, 60, 120, 240]),
      meanSnapM: mean(snapVals), meanLagMin: mean(lagVals), meanPosterior: mean(full.map((f) => f.post ?? 0)), meanCredibility: mean(full.map((f) => f.cred)),
      multiWitness: full.filter((f) => f.wc > 1).length,
    },
    audit,
  });
}
