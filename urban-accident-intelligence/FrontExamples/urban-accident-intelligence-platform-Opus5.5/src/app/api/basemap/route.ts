import { eq } from "drizzle-orm";
import { db } from "@/db";
import { basemapFeatures } from "@/db/schema";
import { networkDatasetId, networkNodes } from "@/lib/server/data";
import { handle } from "@/lib/server/http";
import { ensureSeeded } from "@/lib/server/seed";

export const dynamic = "force-dynamic";

/** GET /api/basemap — offline synthetic basemap context (land-use blocks, water, intersections). */
export const GET = handle(async () => {
  await ensureSeeded();
  const ds = await networkDatasetId();
  if (!ds) return Response.json({ type: "FeatureCollection", features: [] });
  const rows = await db.select().from(basemapFeatures).where(eq(basemapFeatures.datasetId, ds));
  const nodes = await networkNodes();
  return Response.json({
    type: "FeatureCollection",
    features: [
      ...rows.map((r) => ({ type: "Feature", geometry: { type: "Polygon", coordinates: r.geom }, properties: { kind: r.kind } })),
      ...nodes.map((n) => ({ type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] }, properties: { kind: "node", signalized: n.signalized, degree: n.degree, id: n.id } })),
    ],
  });
});
