import { db } from "@/db";
import { accidents, auditLogs, reportAttachments, severityLevels, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadNetwork } from "@/lib/geo/loader";
import { filterSQL, parseFilters } from "@/lib/api/filters";
import { credibilityScore, mapMatch } from "@/lib/analysis/mapmatch";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const loaded = await loadNetwork();
  if (!loaded) return Response.json({ type: "FeatureCollection", features: [] });
  const sp = new URL(req.url).searchParams;
  const f = parseFilters(sp);
  const limit = Math.min(5000, Number(sp.get("limit") ?? 5000));
  const rows = await db.select().from(accidents).where(filterSQL(loaded.source.id, f)).limit(limit);
  return Response.json({
    type: "FeatureCollection",
    features: rows.map((a) => ({
      type: "Feature", id: a.id,
      properties: { id: a.id, status: a.status, severityId: a.severityId, categoryId: a.categoryId, occurredAt: a.occurredAt, reportedAt: a.reportedAt, segmentId: a.segmentId, lixelId: a.lixelId, offsetM: a.offsetM, snapDistanceM: a.snapDistanceM, snapPosterior: a.snapPosterior, uncertaintyRadiusM: a.uncertaintyRadiusM, witnessCount: a.witnessCount, credibility: a.credibility, weather: a.weather, lighting: a.lighting, vehicles: a.vehicles, pedestrians: a.pedestrians, isSynthetic: a.isSynthetic, rawLon: a.rawLon, rawLat: a.rawLat },
      geometry: { type: "Point", coordinates: [a.snapLon ?? a.rawLon, a.snapLat ?? a.rawLat] },
    })),
  });
}

interface ReportBody { lon: number; lat: number; uncertaintyRadiusM: number; occurredAt: string; categoryId: number; severityId: number; vehicles: number; pedestrians: number; emergencyPresent: boolean; weather: string; lighting: string; description?: string; attachments?: { filename: string; mimeType: string; sizeBytes: number }[]; chosenSegmentId?: number }

export async function POST(req: Request) {
  const loaded = await loadNetwork();
  if (!loaded) return Response.json({ error: "No active dataset. Run the simulator first." }, { status: 400 });
  const b = (await req.json()) as ReportBody;
  const errs: string[] = [];
  if (typeof b.lon !== "number" || typeof b.lat !== "number" || Math.abs(b.lon) > 180 || Math.abs(b.lat) > 90) errs.push("Invalid coordinates");
  const occurred = new Date(b.occurredAt); const now = new Date();
  if (isNaN(occurred.getTime())) errs.push("Invalid incident timestamp");
  else if (occurred.getTime() > now.getTime() + 5 * 60e3) errs.push("Incident time cannot be in the future");
  else if (now.getTime() - occurred.getTime() > 400 * 86400e3) errs.push("Incident older than 400 days");
  const unc = Number(b.uncertaintyRadiusM); if (isNaN(unc) || unc < 1 || unc > 500) errs.push("Uncertainty radius must be 1–500 m");
  const sevs = await db.select().from(severityLevels);
  if (!sevs.find((s) => s.id === b.severityId)) errs.push("Unknown severity");
  if (!Number.isInteger(b.categoryId)) errs.push("Unknown category");
  const veh = Math.max(0, Math.min(20, Number(b.vehicles) || 0)), ped = Math.max(0, Math.min(20, Number(b.pedestrians) || 0));
  if (veh + ped === 0) errs.push("At least one vehicle or pedestrian must be involved");
  const { net, proj, source } = loaded;
  const raw = proj.toXY(b.lon, b.lat);
  // spatial validity: must be within network envelope + 300 m
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const n of net.nodes.values()) { minx = Math.min(minx, n.xy[0]); maxx = Math.max(maxx, n.xy[0]); miny = Math.min(miny, n.xy[1]); maxy = Math.max(maxy, n.xy[1]); }
  if (raw[0] < minx - 300 || raw[0] > maxx + 300 || raw[1] < miny - 300 || raw[1] > maxy + 300) errs.push("Location outside the study-area network envelope");
  if (errs.length) return Response.json({ error: errs.join("; ") }, { status: 422 });

  const cands = mapMatch(net, raw, unc);
  const best = (b.chosenSegmentId ? cands.find((c) => c.segmentId === b.chosenSegmentId) : undefined) ?? cands[0];
  if (!best) return Response.json({ error: "No road segment within matching radius (80 m)" }, { status: 422 });
  const lix = net.lixelAt(best.segmentId, best.m);
  const [citizen] = await db.select().from(users).where(eq(users.role, "citizen"));
  const snapLL = proj.toLonLat(best.point[0], best.point[1]);
  const desc = (b.description ?? "").toString().slice(0, 1000).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  const [row] = await db.insert(accidents).values({
    sourceId: source.id, reporterId: citizen?.id, categoryId: b.categoryId, severityId: b.severityId, status: "raw", isSynthetic: false,
    rawLon: b.lon, rawLat: b.lat, rawX: raw[0], rawY: raw[1], uncertaintyRadiusM: unc,
    snapLon: snapLL[0], snapLat: snapLL[1], snapX: best.point[0], snapY: best.point[1], segmentId: best.segmentId, lixelId: lix?.id ?? null, offsetM: best.m, snapDistanceM: best.distanceM, snapPosterior: best.posterior,
    snapCandidates: cands.map((c) => ({ segmentId: c.segmentId, m: +c.m.toFixed(1), distanceM: +c.distanceM.toFixed(1), posterior: +c.posterior.toFixed(3), roadClass: c.roadClass })),
    occurredAt: occurred, reportedAt: now, vehicles: veh, pedestrians: ped, emergencyPresent: !!b.emergencyPresent,
    weather: String(b.weather ?? "clear").slice(0, 20), lighting: String(b.lighting ?? "daylight").slice(0, 20), description: desc,
    witnessCount: 1, credibility: credibilityScore(1, best.posterior, 0.8),
  }).returning();
  if (Array.isArray(b.attachments) && b.attachments.length) {
    // privacy-preserving: only sanitised filename/mime/size metadata is retained (EXIF/GPS never stored)
    await db.insert(reportAttachments).values(b.attachments.slice(0, 5).map((a) => ({ accidentId: row.id, filename: String(a.filename).replace(/[^\w.\-]/g, "_").slice(0, 120), mimeType: String(a.mimeType).slice(0, 60), sizeBytes: Math.max(0, Number(a.sizeBytes) || 0), metadataStripped: true })));
  }
  await db.insert(auditLogs).values({ actorId: citizen?.id, entity: "accidents", entityId: row.id, action: "submit_report", details: { snapPosterior: best.posterior, snapDistanceM: best.distanceM, candidates: cands.length } });
  return Response.json({ ok: true, id: row.id, status: row.status, snap: { segmentId: best.segmentId, offsetM: best.m, distanceM: best.distanceM, posterior: best.posterior, lixelId: lix?.id }, candidates: cands });
}
