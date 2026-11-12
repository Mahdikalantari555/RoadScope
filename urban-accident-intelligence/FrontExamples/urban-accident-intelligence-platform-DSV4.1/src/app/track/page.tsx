import { TrackReport } from "@/components/track/TrackReport";

export const dynamic = "force-dynamic";

export default async function TrackPage({ searchParams }: { searchParams: Promise<{ publicId?: string }> }) {
  const params = await searchParams;
  return <TrackReport initialPublicId={params.publicId ?? ""} />;
}
