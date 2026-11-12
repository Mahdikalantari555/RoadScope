import { Explorer } from "@/components/explorer/Explorer";
import { loadMetadata } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  const meta = await loadMetadata();
  return (
    <Explorer
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
