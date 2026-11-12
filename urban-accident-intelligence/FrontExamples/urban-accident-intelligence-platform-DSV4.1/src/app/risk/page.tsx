import Link from "next/link";
import { getSession, canAnalyse } from "@/lib/auth";
import { RiskWorkspace } from "@/components/risk/RiskWorkspace";
import { loadMetadata } from "@/lib/data";
import { Callout, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RiskPage() {
  const session = await getSession();
  const meta = await loadMetadata();
  if (!canAnalyse(session?.role)) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <Panel title="Risk assessment workspace">
          <Callout tone="warn" title="Analyst access required">
            The weighted risk engine is a sensitive analytical product: it must not be mistaken for a validated prediction. Analyst or
            administrator access is required to configure and export it.
          </Callout>
          <Link href="/login?next=/risk" className="btn btn-primary mt-3">
            Sign in to continue
          </Link>
        </Panel>
      </div>
    );
  }
  return (
    <RiskWorkspace
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
