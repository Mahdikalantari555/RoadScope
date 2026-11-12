import { ReportForm } from "@/components/report/ReportForm";
import { loadMetadata } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ReportPage() {
  const meta = await loadMetadata();
  return <ReportForm categories={meta.categories} severities={meta.severities} districts={meta.districts} />;
}
