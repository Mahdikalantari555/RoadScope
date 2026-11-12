import { eq } from "drizzle-orm";
import { db } from "@/db";
import { reportAttachments } from "@/db/schema";
import { jsonError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return jsonError("Invalid attachment id.", 400);
  const rows = await db.select().from(reportAttachments).where(eq(reportAttachments.id, numeric)).limit(1);
  if (rows.length === 0 || !rows[0].content) return jsonError("Attachment not found.", 404);
  const buffer = Buffer.from(rows[0].content, "base64");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": rows[0].mimeType,
      "Content-Length": String(buffer.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
