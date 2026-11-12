import { db } from "@/db";
import { accidents, auditLogs, reportVerifications, severityLevels, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { attributeConsistency, credibilityScore, mapMatch } from "@/lib/analysis/mapmatch";
import { loadNetwork } from "@/lib/geo/loader";

export const dynamic = "force-dynamic";

async function actor(role: string) { const [u] = await db.select().from(users).where(eq(users.role, role)); return u ?? null; }

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [a] = await db.select().from(accidents).where(eq(accidents.id, Number(id)));
  if (!a) return Response.json({ error: "not found" }, { status: 404 });
  const verifs = await db.select().from(reportVerifications).where(eq(reportVerifications.accidentId, a.id));
  const children = await db.select({ id: accidents.id, status: accidents.status, occurredAt: accidents.occurredAt, credibility: accidents.credibility }).from(accidents).where(eq(accidents.canonicalId, a.id));
  return Response.json({ accident: a, verifications: verifs, children });
}

/**
 * Lifecycle actions. Role gate: steward/admin for verify|reject|flag|merge|edit; citizens may only corroborate.
 * Role is asserted via x-role header (demo RBAC; swap for session auth in deployment).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json();
  const action = String(body.action);
  const role = req.headers.get("x-role") ?? "citizen";
  const stewardOnly = ["verify", "reject", "flag", "merge", "edit"];
  if (stewardOnly.includes(action) && !["steward", "admin"].includes(role)) return Response.json({ error: "forbidden: steward role required" }, { status: 403 });
  const [a] = await db.select().from(accidents).where(eq(accidents.id, Number(id)));
  if (!a) return Response.json({ error: "not found" }, { status: 404 });
  const who = await actor(stewardOnly.includes(action) ? "steward" : "citizen");
  const sevs = await db.select().from(severityLevels);
  const rank = (sid: number) => sevs.find((s) => s.id === sid)?.rank ?? 1;
  let update: Partial<typeof accidents.$inferInsert> = {};
  let details: Record<string, unknown> = {};

  if (action === "corroborate") {
    const wc = a.witnessCount + 1;
    const cons = body.categoryId && body.severityId ? attributeConsistency({ categoryId: a.categoryId, severityRank: rank(a.severityId), vehicles: a.vehicles }, { categoryId: Number(body.categoryId), severityRank: rank(Number(body.severityId)), vehicles: Number(body.vehicles ?? a.vehicles) }) : 0.8;
    update = { witnessCount: wc, credibility: credibilityScore(wc, a.snapPosterior ?? 0.5, cons) };
    details = { witnessCount: wc, consistency: cons };
  } else if (action === "verify" || action === "reject" || action === "flag") {
    update = { status: action === "verify" ? "verified" : action === "reject" ? "rejected" : "flagged" };
    if (action === "verify") update.credibility = Math.max(a.credibility, 0.85);
  } else if (action === "merge") {
    const targetId = Number(body.targetId);
    const [target] = await db.select().from(accidents).where(eq(accidents.id, targetId));
    if (!target || target.id === a.id) return Response.json({ error: "invalid merge target" }, { status: 400 });
    const wc = target.witnessCount + a.witnessCount;
    const cons = attributeConsistency({ categoryId: a.categoryId, severityRank: rank(a.severityId), vehicles: a.vehicles }, { categoryId: target.categoryId, severityRank: rank(target.severityId), vehicles: target.vehicles });
    await db.update(accidents).set({ witnessCount: wc, credibility: credibilityScore(wc, target.snapPosterior ?? 0.5, cons) }).where(eq(accidents.id, targetId));
    update = { status: "merged", canonicalId: targetId };
    details = { targetId, witnessCount: wc, consistency: cons };
    await db.insert(reportVerifications).values({ accidentId: targetId, reviewerId: who?.id, action: "merge", notes: `absorbed child report #${a.id}` });
  } else if (action === "edit") {
    const loaded = await loadNetwork(a.sourceId);
    update = {};
    if (body.severityId) update.severityId = Number(body.severityId);
    if (body.categoryId) update.categoryId = Number(body.categoryId);
    if (typeof body.description === "string") update.description = body.description.slice(0, 1000);
    if (loaded && typeof body.lon === "number" && typeof body.lat === "number") {
      const p = loaded.proj.toXY(body.lon, body.lat);
      const c = mapMatch(loaded.net, p, a.uncertaintyRadiusM)[0];
      if (c) { const ll = loaded.proj.toLonLat(c.point[0], c.point[1]); const lix = loaded.net.lixelAt(c.segmentId, c.m); Object.assign(update, { snapLon: ll[0], snapLat: ll[1], snapX: c.point[0], snapY: c.point[1], segmentId: c.segmentId, lixelId: lix?.id ?? null, offsetM: c.m, snapDistanceM: c.distanceM, snapPosterior: c.posterior }); }
    }
    if (body.chosenSegmentId && loaded) {
      const cands = mapMatch(loaded.net, [a.rawX, a.rawY], a.uncertaintyRadiusM);
      const c = cands.find((x) => x.segmentId === Number(body.chosenSegmentId));
      if (c) { const ll = loaded.proj.toLonLat(c.point[0], c.point[1]); const lix = loaded.net.lixelAt(c.segmentId, c.m); Object.assign(update, { snapLon: ll[0], snapLat: ll[1], snapX: c.point[0], snapY: c.point[1], segmentId: c.segmentId, lixelId: lix?.id ?? null, offsetM: c.m, snapDistanceM: c.distanceM, snapPosterior: c.posterior }); }
    }
    details = { fields: Object.keys(update) };
  } else return Response.json({ error: "unknown action" }, { status: 400 });

  await db.update(accidents).set(update).where(eq(accidents.id, a.id));
  await db.insert(reportVerifications).values({ accidentId: a.id, reviewerId: who?.id, action, notes: body.notes ? String(body.notes).slice(0, 500) : null });
  await db.insert(auditLogs).values({ actorId: who?.id, entity: "accidents", entityId: a.id, action, details: { ...details, role, before: { status: a.status, witnessCount: a.witnessCount } } });
  const [after] = await db.select().from(accidents).where(eq(accidents.id, a.id));
  return Response.json({ ok: true, accident: after });
}
