import { cookies } from "next/headers";
import { jsonOk } from "@/lib/api";
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return jsonOk({ ok: true });
}
