import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accidents, reportVerifications } from "@/db/schema";
import { requireAdmin } from "@/lib/server/auth";
import { audit } from "@/lib/server/data";
import { ApiError, handle, parseBody } from "@/lib/server/http";
import { reviewSchema } from "@/lib/server/schemas";

export const dynamic = "force-dynamic";

/** POST /api/accidents/:id/review — verify / reject / mark duplicate / reopen. */
export const POST = handle(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const admin = await requireAdmin();
  const id = Number((await ctx.params).id);
  const b = await parseBody(req, reviewSchema);
  const [a] = await db.select({ status: accidents.status, flags: accidents.qualityFlags, duplicateOfId: accidents.duplicateOfId }).from(accidents).where(eq(accidents.id, id));
  if (!a) throw new ApiError(404, "Accident not found");
  const next = ({ verify: "verified", reject: "rejected", mark_duplicate: "duplicate", reopen: "reported" } as const)[b.action];
  const patch: Partial<typeof accidents.$inferInsert> = { status: next, updatedAt: new Date() };
  if (b.action === "mark_duplicate") {
    const target = b.duplicateOfId ?? a.duplicateOfId;
    if (!target || target === id) throw new ApiError(422, "A valid duplicateOfId is required");
    const [t] = await db.select({ id: accidents.id }).from(accidents).where(eq(accidents.id, target));
    if (!t) throw new ApiError(422, "Referenced original report does not exist");
    patch.duplicateOfId = target;
  }
  if (b.action === "verify") patch.qualityFlags = a.flags.filter((f) => f !== "possible_duplicate");
  await db.update(accidents).set(patch).where(eq(accidents.id, id));
  await db.insert(reportVerifications).values({ accidentId: id, reviewerId: admin.id, action: b.action, previousStatus: a.status, newStatus: next, note: b.note });
  await audit(admin.id, `report.${b.action}`, "accident", id, { from: a.status, to: next, note: b.note });
  return Response.json({ id, status: next });
});
