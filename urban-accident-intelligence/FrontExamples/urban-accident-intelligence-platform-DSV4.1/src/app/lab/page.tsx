import Link from "next/link";
import { getSession, canAnalyse } from "@/lib/auth";
import { LabWorkspace } from "@/components/lab/LabWorkspace";
import { loadMetadata } from "@/lib/data";
import { Callout, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function LabPage() {
  const session = await getSession();
  const meta = await loadMetadata();
  if (!canAnalyse(session?.role)) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <Panel title="Spatial analysis laboratory">
          <Callout tone="warn" title="Analyst access required">
            The analysis laboratory runs computationally intensive spatial statistics and persists job provenance. Sign in with the analyst or
            administrator demo account to continue.
          </Callout>
          <div className="mt-3 space-y-1 text-[11.5px] text-muted">
            <p className="mono">analyst@vantia.example · analyst1234</p>
            <p className="mono">admin@vantia.example · admin1234</p>
          </div>
          <Link href="/login?next=/lab" className="btn btn-primary mt-3">
            Sign in to continue
          </Link>
        </Panel>
      </div>
    );
  }
  return (
    <LabWorkspace
      initialMeta={{
        categories: meta.categories,
        severities: meta.severities,
        districts: meta.districts,
        datasets: meta.datasets,
        segments: meta.segments.length,
        intersections: meta.intersections.length,
      }}
      role={session?.role ?? "citizen"}
    />
  );
}
