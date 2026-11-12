import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { datasetSources } from "@/db/schema";
import { requireAdmin } from "@/lib/server/auth";
import { audit, invalidateNetwork } from "@/lib/server/data";
import { ApiError, handle, parseBody } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** PATCH /api/datasets/:id — activate/deactivate a dataset source (admin). */
export const PATCH = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const id = Number((await ctx.params).id);
  const b = await parseBody(req, z.object({ isActive: z.boolean() }));
  const [ds] = await db.select().from(datasetSources).where(eq(datasetSources.id, id));
  if (!ds) throw new ApiError(404, "Dataset not found");
  if (ds.kind === "synthetic" && !b.isActive) throw new ApiError(409, "The synthetic dataset also provides the road network and cannot be deactivated. Toggle the citizen dataset or regenerate instead.");
  await db.update(datasetSources).set({ isActive: b.isActive }).where(eq(datasetSources.id, id));
  invalidateNetwork();
  await audit(admin.id, "dataset.toggle", "dataset_source", id, { isActive: b.isActive });
  return Response.json({ id, isActive: b.isActive });
});
