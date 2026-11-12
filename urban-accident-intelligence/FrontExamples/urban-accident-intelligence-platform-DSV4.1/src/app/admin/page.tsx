import Link from "next/link";
import { getSession } from "@/lib/auth";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { Callout, Panel } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const session = await getSession();
  if (session?.role !== "admin") {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <Panel title="Moderation & data quality">
          <Callout tone="warn" title="Administrator access required">
            Moderation changes the verification state of records and writes an immutable audit entry. Only the administrator role may verify,
            reject, merge duplicates or edit records.
          </Callout>
          <div className="mt-3 space-y-1 text-[11.5px] text-muted">
            <p>Demo administrator credentials:</p>
            <p className="mono">admin@vantia.example · admin1234</p>
          </div>
          <Link href="/login?next=/admin" className="btn btn-primary mt-3">
            Sign in as administrator
          </Link>
        </Panel>
        <Panel title="Current session">
          <p className="text-[11.5px] text-muted">
            {session ? `${session.name} — role ${session.role}. Elevate to admin to moderate.` : "No session. Sign in to continue."}
          </p>
        </Panel>
      </div>
    );
  }
  return <AdminConsole actor={session.name} />;
}
