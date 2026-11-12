import { and, between, ne } from "drizzle-orm";
import { db } from "@/db";
import { accidents } from "@/db/schema";
import { DEFAULT_DUP_OPTIONS, findDuplicateCandidates } from "@/lib/geo/duplicates";
import { getMeta, getNetwork, snapToNetwork } from "@/lib/server/data";
import { handle, parseBody } from "@/lib/server/http";
import { duplicateCheckSchema } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";

/** POST /api/accidents/check — pre-submission location validation + duplicate warning. */
export const POST = handle(async (req: Request) => {
  const b = await parseBody(req, duplicateCheckSchema);
  const meta = await getMeta();
  const net = await getNetwork();
  const snap = await snapToNetwork(b.lon, b.lat);
  const t = Date.parse(b.occurredAt);
  const r = DEFAULT_DUP_OPTIONS.radius;
  const win = DEFAULT_DUP_OPTIONS.windowMin * 60000;
  const near = Number.isNaN(t)
    ? []
    : await db
        .select({ id: accidents.id, x: accidents.x, y: accidents.y, t: accidents.occurredAt, categoryId: accidents.categoryId, severityId: accidents.severityId, trackingCode: accidents.trackingCode, status: accidents.status })
        .from(accidents)
        .where(and(between(accidents.x, snap.x - r, snap.x + r), between(accidents.y, snap.y - r, snap.y + r), between(accidents.occurredAt, new Date(t - win), new Date(t + win)), ne(accidents.status, "rejected")));
  const cands = findDuplicateCandidates(
    { id: -1, x: snap.x, y: snap.y, t, category: b.category, severityRank: meta.severities.find((s) => s.code === b.severity)?.rank ?? 1 },
    near.map((n) => ({ id: n.id, x: n.x, y: n.y, t: n.t.getTime(), category: meta.catById.get(n.categoryId) ?? "other", severityRank: meta.sevById.get(n.severityId)?.rank ?? 1 })),
  );
  return Response.json({
    snap: { lon: snap.lon, lat: snap.lat, distanceM: snap.snapDistanceM, segmentName: snap.segmentId ? net?.byId.get(snap.segmentId)?.name : null, flags: snap.flags },
    candidates: cands.slice(0, 5).map((c) => {
      const n = near.find((x) => x.id === c.id)!;
      return { trackingCode: n.trackingCode, status: n.status, score: c.score, distanceM: c.distanceM, dtMin: c.dtMin, likely: c.score >= DEFAULT_DUP_OPTIONS.threshold };
    }),
  });
});
