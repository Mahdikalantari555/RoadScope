import { NextResponse } from "next/server";
import { loadSegments, queryAccidents } from "@/lib/repo";
import { computeDashboard, gini } from "@/lib/stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [page, segments] = await Promise.all([queryAccidents({}, 20000, 0), loadSegments()]);
    const stats = computeDashboard(page.data, segments);
    const districtCounts = stats.districts.map((d) => d.count);
    return NextResponse.json({
      ...stats,
      concentration: {
        districtGini: Math.round(gini(districtCounts) * 1000) / 1000,
        topDistrictShare: districtCounts.length
          ? Math.round((Math.max(...districtCounts) / page.data.length) * 1000) / 1000
          : 0,
        note: "Descriptive concentration of reported events across administrative districts. Not a measure of statistical significance.",
      },
      synthetic: true,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ error: "Failed to compute statistics", detail: String(err) }, { status: 500 });
  }
}
