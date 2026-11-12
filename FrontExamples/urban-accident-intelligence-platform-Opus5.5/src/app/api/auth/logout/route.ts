import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/server/auth";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const POST = handle(async () => {
  (await cookies()).delete(SESSION_COOKIE);
  return Response.json({ ok: true });
});
