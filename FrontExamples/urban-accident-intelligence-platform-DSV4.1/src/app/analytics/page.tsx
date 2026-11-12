import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { loadMetadata } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const meta = await loadMetadata();
  return (
    <AnalyticsDashboard
      initialMeta={{
        categories: meta.categories,
        severities: meta.severities,
        districts: meta.districts,
        datasets: meta.datasets,
        segments: meta.segments.length,
        intersections: meta.intersections.length,
      }}
    />
  );
}
