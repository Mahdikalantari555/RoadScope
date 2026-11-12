import { NextResponse } from "next/server";
import { listAudit, getVerificationCounts, getStatusCounts, getEnvironmentalStats } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [audit, verifications, statuses, environmental] = await Promise.all([
      listAudit(80),
      getVerificationCounts(),
      getStatusCounts(),
      getEnvironmentalStats(),
    ]);
    return NextResponse.json({ audit, verifications, statuses, environmental });
  } catch (err) {
    return NextResponse.json({ error: "Failed to load audit data", detail: String(err) }, { status: 500 });
  }
}
