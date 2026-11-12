import { jsonOk } from "@/lib/api";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return jsonOk({ session });
}
