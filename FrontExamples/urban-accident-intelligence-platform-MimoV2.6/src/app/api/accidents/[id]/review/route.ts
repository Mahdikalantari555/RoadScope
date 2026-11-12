import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accidents, reportVerifications } from "@/db/schema";
import { insertAudit } from "@/lib/repo";

export const dynamic = "force-dynamic";

const reviewSchema = z
  .object({
    decision: z.enum(["verified", "rejected", "duplicate", "reopened"]),
    reviewerName: z.string().min(2).max(80),
    reviewerUserId: z.number().int().optional(),
    confidence: z.number().min(0).max(1).default(0.8),
    notes: z.string().max(1200).optional(),
    duplicateOfId: z.number().int().optional(),
  })
  .strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const numeric = Number(id);
  if (!Number.isFinite(numeric)) return NextResponse.json({ error: "Invalid accident id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 422 },
    );
  }
  const d = parsed.data;

  const rows = await db.select().from(accidents).where(eq(accidents.id, numeric));
  if (!rows.length) return NextResponse.json({ error: "Accident not found" }, { status: 404 });

  const status = d.decision === "reopened" ? "pending" : d.decision;
  await db
    .update(accidents)
    .set({
      status,
      duplicateOfId: d.decision === "duplicate" ? (d.duplicateOfId ?? rows[0].duplicateOfId) : null,
      rejectReason: d.decision === "rejected" ? (d.notes ?? "Rejected on review.") : null,
      updatedAt: new Date(),
    })
    .where(eq(accidents.id, numeric));

  await db.insert(reportVerifications).values({
    accidentId: numeric,
    reviewerUserId: d.reviewerUserId ?? null,
    reviewerName: d.reviewerName,
    decision: d.decision,
    confidence: d.confidence,
    notes: d.notes ?? null,
  });

  await insertAudit({
    actorRole: "administrator",
    actorName: d.reviewerName,
    action: `report.${d.decision}`,
    entityType: "accidents",
    entityId: rows[0].publicId,
    detail: { confidence: d.confidence, notes: d.notes ?? null },
  });

  return NextResponse.json({ ok: true, id: numeric, status });
}
