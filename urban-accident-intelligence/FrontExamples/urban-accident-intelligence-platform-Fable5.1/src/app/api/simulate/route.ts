import { db } from "@/db";
import { accidents, datasetSources, roadLixels, roadSegments } from "@/db/schema";
import { count, desc, eq } from "drizzle-orm";
import { DEFAULT_PARAMS, runSimulation, type SimParams } from "@/lib/sim/generator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const sources = await db.select().from(datasetSources).orderBy(desc(datasetSources.id));
  const out = [];
  for (const s of sources) {
    const [[a], [l], [g]] = await Promise.all([
      db.select({ n: count() }).from(accidents).where(eq(accidents.sourceId, s.id)),
      db.select({ n: count() }).from(roadLixels).where(eq(roadLixels.sourceId, s.id)),
      db.select({ n: count() }).from(roadSegments).where(eq(roadSegments.sourceId, s.id)),
    ]);
    out.push({ ...s, reports: a.n, lixels: l.n, segments: g.n });
  }
  return Response.json({ sources: out, defaults: DEFAULT_PARAMS });
}

export async function POST(req: Request) {
  let body: Partial<SimParams> = {};
  try { body = await req.json(); } catch { /* defaults */ }
  const clean: Partial<SimParams> = {};
  const num = (k: keyof SimParams, lo: number, hi: number) => { const v = Number(body[k]); if (!isNaN(v) && body[k] !== undefined) (clean as Record<string, unknown>)[k] = Math.min(hi, Math.max(lo, v)); };
  num("seed", 0, 2 ** 31); num("lixelResolution", 10, 100); num("gridCols", 4, 12); num("gridRows", 4, 12); num("spacingM", 120, 400); num("days", 14, 365);
  num("expectedEvents", 50, 3000); num("positionalSigmaM", 0, 60); num("falseAlarmRate", 0, 0.5); num("lagMeanMin", 0, 600); num("intersectionAlpha", 0, 10); num("preVerifiedFraction", 0, 1);
  if (["uniform", "intersection", "diurnal", "complex"].includes(String(body.scenario))) clean.scenario = body.scenario;
  try {
    const t0 = Date.now();
    const res = await runSimulation(clean);
    return Response.json({ ok: true, ...res, runtimeMs: Date.now() - t0 });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error).message ?? e) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const { sourceId } = await req.json();
  await db.update(datasetSources).set({ isActive: false });
  await db.update(datasetSources).set({ isActive: true }).where(eq(datasetSources.id, Number(sourceId)));
  const { invalidateNetworkCache } = await import("@/lib/geo/loader");
  invalidateNetworkCache();
  return Response.json({ ok: true });
}
