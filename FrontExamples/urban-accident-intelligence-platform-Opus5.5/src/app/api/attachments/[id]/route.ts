import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reportAttachments } from "@/db/schema";
import { requireAdmin } from "@/lib/server/auth";
import { ApiError, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** GET /api/attachments/:id — binary image, administrators only (privacy). */
export const GET = handle(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin();
  const id = Number((await ctx.params).id);
  const [a] = await db.select().from(reportAttachments).where(eq(reportAttachments.id, id));
  if (!a) throw new ApiError(404, "Attachment not found");
  const b64 = a.dataBase64.includes(",") ? a.dataBase64.split(",")[1] : a.dataBase64;
  return new Response(Buffer.from(b64, "base64"), { headers: { "Content-Type": a.mimeType, "Cache-Control": "private, max-age=600" } });
});
