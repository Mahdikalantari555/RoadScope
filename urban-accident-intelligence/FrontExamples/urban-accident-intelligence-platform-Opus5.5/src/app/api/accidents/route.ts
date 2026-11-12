import { randomBytes } from "node:crypto";
import { and, asc, between, count, desc, eq, ilike, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { accidents, datasetSources, environmentalObservations, reportAttachments } from "@/db/schema";
import { DEFAULT_DUP_OPTIONS, findDuplicateCandidates } from "@/lib/geo/duplicates";
import { lightCondition } from "@/lib/geo/time";
import { currentUser, hashContact } from "@/lib/server/auth";
import { audit, buildWhere, getMeta, getNetwork, networkDatasetId, snapToNetwork } from "@/lib/server/data";
import { ApiError, handle, parseBody, parseFilters } from "@/lib/server/http";
import { reportSchema } from "@/lib/server/schemas";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

/** GET /api/accidents — filtered retrieval; `format=geojson` returns a FeatureCollection, otherwise paginated JSON. */
export const GET = handle(async (req: Request) => {
  await ensureSeeded();
  const url = new URL(req.url);
  const sp = url.searchParams;
  const f = parseFilters(sp);
  const meta = await getMeta();
  const extra: SQL[] = [];
  const flag = sp.get("flag");
  if (flag && /^[a-z_]{3,40}$/.test(flag)) extra.push(sql`${accidents.qualityFlags} ? ${flag}`);
  const q = sp.get("q")?.trim();
  if (q) extra.push(ilike(accidents.trackingCode, `%${q.replace(/[%_]/g, "")}%`));
  const base = await buildWhere(f);
  const where = extra.length ? and(base, ...extra) : base;
  const format = sp.get("format") ?? "json";
  const cols = {
    id: accidents.id,
    trackingCode: accidents.trackingCode,
    occurredAt: accidents.occurredAt,
    reportedAt: accidents.reportedAt,
    categoryId: accidents.categoryId,
    severityId: accidents.severityId,
    status: accidents.status,
    lon: accidents.lon,
    lat: accidents.lat,
    segmentId: accidents.segmentId,
    vehicles: accidents.vehicles,
    emergency: accidents.emergencyServices,
    flags: accidents.qualityFlags,
    datasetId: accidents.datasetId,
    isSynthetic: accidents.isSynthetic,
    duplicateOfId: accidents.duplicateOfId,
    duplicateScore: accidents.duplicateScore,
    snapDistanceM: accidents.snapDistanceM,
    weather: accidents.weather,
    light: accidents.lightCondition,
  };
  const map = (r: { categoryId: number; severityId: number } & Record<string, unknown>) => {
    const { categoryId, severityId, ...rest } = r;
    const sev = meta.sevById.get(severityId);
    return { ...rest, category: meta.catById.get(categoryId), severity: sev?.code, severityRank: sev?.rank };
  };
  if (format === "geojson") {
    const limit = Math.min(Number(sp.get("limit") ?? 20000), 50000);
    const rows = await db.select(cols).from(accidents).where(where).orderBy(asc(accidents.occurredAt)).limit(limit);
    return Response.json({
      type: "FeatureCollection",
      features: rows.map((r) => {
        const p = map(r);
        return { type: "Feature", id: r.id, geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: { ...p, occurredAt: r.occurredAt.toISOString(), reportedAt: r.reportedAt.toISOString(), lon: undefined, lat: undefined } };
      }),
    });
  }
  const page = Math.max(1, Number(sp.get("page") ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(sp.get("pageSize") ?? 50)));
  const sort = sp.get("sort") === "oldest" ? asc(accidents.reportedAt) : desc(accidents.reportedAt);
  const [{ total }] = await db.select({ total: count() }).from(accidents).where(where);
  const rows = await db.select({ ...cols, description: accidents.description }).from(accidents).where(where).orderBy(sort).limit(pageSize).offset((page - 1) * pageSize);
  return Response.json({ page, pageSize, total, pages: Math.ceil(total / pageSize), items: rows.map(map) });
});

/** POST /api/accidents — citizen report submission. */
export const POST = handle(async (req: Request) => {
  await ensureSeeded();
  const body = await parseBody(req, reportSchema);
  const meta = await getMeta();
  const net = await getNetwork();
  const occurred = new Date(body.occurredAt);
  const now = Date.now();
  if (occurred.getTime() > now + 15 * 60000) throw new ApiError(422, "Accident time cannot be in the future");
  if (occurred.getTime() < now - 365 * 86400000 * 3) throw new ApiError(422, "Accident time is more than 3 years in the past");
  const snap = await snapToNetwork(body.lon, body.lat);
  if (net && (snap.snapDistanceM === null || snap.snapDistanceM > 1500)) throw new ApiError(422, "Location lies outside the covered study area", { snapDistanceM: snap.snapDistanceM });

  // Duplicate detection against existing (non-rejected) reports in a ±3 h, 150 m window.
  const win = DEFAULT_DUP_OPTIONS.windowMin * 60000;
  const r = DEFAULT_DUP_OPTIONS.radius;
  const near = await db
    .select({ id: accidents.id, x: accidents.x, y: accidents.y, t: accidents.occurredAt, categoryId: accidents.categoryId, severityId: accidents.severityId, trackingCode: accidents.trackingCode })
    .from(accidents)
    .where(and(between(accidents.x, snap.x - r, snap.x + r), between(accidents.y, snap.y - r, snap.y + r), between(accidents.occurredAt, new Date(occurred.getTime() - win), new Date(occurred.getTime() + win)), ne(accidents.status, "rejected")));
  const sevRank = meta.severities.find((s) => s.code === body.severity)?.rank ?? 1;
  const cands = findDuplicateCandidates(
    { id: -1, x: snap.x, y: snap.y, t: occurred.getTime(), category: body.category, severityRank: sevRank },
    near.map((n) => ({ id: n.id, x: n.x, y: n.y, t: n.t.getTime(), category: meta.catById.get(n.categoryId) ?? "other", severityRank: meta.sevById.get(n.severityId)?.rank ?? 1 })),
  );
  const best = cands[0] && cands[0].score >= DEFAULT_DUP_OPTIONS.threshold ? cands[0] : null;
  const flags = [...snap.flags];
  if (best) flags.push("possible_duplicate");

  const [citizenDs] = await db.select({ id: datasetSources.id }).from(datasetSources).where(eq(datasetSources.kind, "citizen"));
  if (!citizenDs) throw new ApiError(500, "Citizen dataset missing");
  const envDs = await networkDatasetId();
  const hourStart = new Date(Math.floor(occurred.getTime() / 3600000) * 3600000);
  const [wx] = envDs ? await db.select({ c: environmentalObservations.condition }).from(environmentalObservations).where(and(eq(environmentalObservations.datasetId, envDs), eq(environmentalObservations.observedAt, hourStart))) : [];
  const user = await currentUser();
  const trackingCode = `UAI-${randomBytes(5).toString("hex").toUpperCase()}`;
  const [row] = await db
    .insert(accidents)
    .values({
      datasetId: citizenDs.id,
      trackingCode,
      occurredAt: occurred,
      reportedAt: new Date(),
      categoryId: meta.catId.get(body.category)!,
      severityId: meta.sevId.get(body.severity)!,
      vehicles: body.vehicles,
      description: body.description,
      emergencyServices: body.emergencyServices,
      status: "reported",
      reportedLon: body.lon,
      reportedLat: body.lat,
      lon: snap.lon,
      lat: snap.lat,
      x: snap.x,
      y: snap.y,
      segmentId: snap.segmentId,
      snapDistanceM: snap.snapDistanceM,
      duplicateOfId: best?.id ?? null,
      duplicateScore: best?.score ?? null,
      qualityFlags: flags,
      weather: wx?.c ?? null,
      lightCondition: lightCondition(occurred.getTime(), body.lat, body.lon),
      reporterId: user?.id ?? null,
      reporterContactHash: body.contact ? hashContact(body.contact) : null,
      isSynthetic: false,
    })
    .returning({ id: accidents.id });
  if (body.attachments.length)
    await db.insert(reportAttachments).values(body.attachments.map((a) => ({ accidentId: row.id, fileName: a.fileName.replace(/[^\w.\- ]/g, "_"), mimeType: a.mimeType, sizeBytes: Math.round((a.dataBase64.length * 3) / 4), dataBase64: a.dataBase64 })));
  await audit(user?.id ?? null, "report.submit", "accident", row.id, { trackingCode, flags });
  const segName = snap.segmentId ? net?.byId.get(snap.segmentId)?.name : null;
  return Response.json(
    {
      id: row.id,
      trackingCode,
      status: "reported",
      flags,
      snap: { distanceM: snap.snapDistanceM, segmentId: snap.segmentId, segmentName: segName },
      duplicateCandidates: cands.slice(0, 3).map((c) => ({ score: c.score, distanceM: c.distanceM, dtMin: c.dtMin, trackingCode: near.find((n) => n.id === c.id)?.trackingCode })),
    },
    { status: 201 },
  );
});
