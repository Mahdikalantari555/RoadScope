"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, FileSearch, MapPin, Search } from "lucide-react";
import { MapView } from "@/components/map/MapView";
import { Callout, EmptyState, LoadingRows, MetricGrid, Panel, SectionLabel, StatusBadge } from "@/components/ui";
import { formatDateTime, useApi, type NetworkResponse } from "@/lib/client/api";

type TrackPayload = {
  publicId: string;
  status: string;
  categoryCode: string;
  severityCode: number;
  occurredAt: string;
  reportedAt: string;
  district: string | null;
  lat: number;
  lng: number;
  positionalUncertaintyM: number;
  locationMethod: string;
  description: string | null;
  duplicateOfId: number | null;
  qualityFlags: string[];
  attachments: number;
  timeline: { id: number; action: string; notes: string | null; createdAt: string; verifier: string | null }[];
  privacyNotice: string;
};

export function TrackReport({ initialPublicId }: { initialPublicId: string }) {
  const [input, setInput] = useState(initialPublicId);
  const [submitted, setSubmitted] = useState(initialPublicId);
  const [error, setError] = useState<string | null>(null);
  const network = useApi<NetworkResponse>("/api/network");

  useEffect(() => {
    setInput(initialPublicId);
    setSubmitted(initialPublicId);
  }, [initialPublicId]);

  const result = useApi<TrackPayload | null>(submitted ? `/api/accidents/track?publicId=${encodeURIComponent(submitted)}` : null, [submitted]);

  useEffect(() => {
    if (result.error) setError(result.error);
    else setError(null);
  }, [result.error]);

  const data = result.data;
  const feature: GeoJSON.FeatureCollection = data
    ? {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [data.lng, data.lat] },
            properties: { publicId: data.publicId, status: data.status, severity: data.severityCode },
          },
        ],
      }
    : { type: "FeatureCollection", features: [] };

  return (
    <div className="mx-auto max-w-[1200px] space-y-2.5 p-2.5">
      <Panel title="Track a report" icon={<FileSearch size={12} />}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(input.trim());
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="label-caps mb-1 block">Tracking reference</span>
            <input className="input mono" value={input} onChange={(event) => setInput(event.target.value)} placeholder="VNT-2025-C4XKQ" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            <Search size={12} /> Look up
          </button>
          <Link href="/report" className="btn btn-xs">New report</Link>
        </form>
        <p className="mt-1.5 text-[10px] leading-relaxed text-faint">
          The tracking endpoint returns status, verification timeline and location uncertainty. Reporter identity and contact details are never
          exposed. Status changes are append-only.
        </p>
      </Panel>

      {result.loading && (
        <Panel title="Report">
          <LoadingRows rows={5} />
        </Panel>
      )}

      {!submitted && !result.loading && (
        <Panel title="Report">
          <EmptyState title="Enter a reference" message="Use the reference returned after submission (for example a seeded record such as VNT-2025-00012) to inspect its verification history." icon={<Search size={22} />} />
        </Panel>
      )}

      {error && (
        <Callout tone="danger" title="Lookup failed">
          {error}. Check the reference and retry.
        </Callout>
      )}

      {data && (
        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-2.5">
            <Panel title={`Report ${data.publicId}`} icon={<Clock size={12} />} actions={<StatusBadge status={data.status} />}>
              <div className="space-y-2">
                <MetricGrid
                  metrics={[
                    { label: "Occurred (UTC)", value: formatDateTime(data.occurredAt) },
                    { label: "Reported (UTC)", value: formatDateTime(data.reportedAt) },
                    { label: "Category", value: data.categoryCode.replace(/_/g, " ") },
                    { label: "Severity", value: String(data.severityCode) },
                    { label: "District", value: data.district ?? "—" },
                    { label: "Location method", value: data.locationMethod },
                    { label: "Positional uncertainty", value: `± ${data.positionalUncertaintyM.toFixed(0)} m` },
                    { label: "Attachments", value: String(data.attachments) },
                  ]}
                />
                <p className="border-l-2 border-line pl-2 text-[11.5px] leading-relaxed text-muted">{data.description}</p>
                {data.qualityFlags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {data.qualityFlags.map((flag) => (
                      <span key={flag} className="badge badge-warn">{flag.replace(/_/g, " ")}</span>
                    ))}
                  </div>
                )}
                <Callout tone={data.status === "verified" ? "info" : "warn"} title={data.status === "verified" ? "Verified by a moderator" : "Not yet confirmed"}>
                  {data.status === "verified"
                    ? "Verification means a moderator cross-checked the record. It is not a legal determination and does not imply fault."
                    : "Pending or duplicate records are excluded from verified statistics. They remain visible as unverified observations."}
                </Callout>
              </div>
            </Panel>

            <Panel title="Verification timeline" icon={<Clock size={12} />}>
              {data.timeline.length === 0 ? (
                <p className="text-[11px] leading-relaxed text-faint">
                  {data.status === "verified"
                    ? "This record originates from the synthetic register dataset and was verified at source ingestion, so there are no individual moderation events. Citizen submissions always carry a review timeline."
                    : "No moderation events yet. The record is awaiting review in the administrator queue."}
                </p>
              ) : (
                <ol className="space-y-2">
                  {data.timeline.map((entry) => (
                    <li key={entry.id} className="relative border-l border-line pl-3">
                      <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="mono text-[11px] text-ink">{entry.action}</span>
                        <span className="mono text-[10px] text-faint">{formatDateTime(entry.createdAt)}</span>
                      </div>
                      <div className="text-[10px] text-faint">{entry.verifier ?? "system"}</div>
                      {entry.notes && <p className="text-[10.5px] leading-relaxed text-muted">{entry.notes}</p>}
                    </li>
                  ))}
                </ol>
              )}
              <p className="mt-2 text-[9.5px] leading-relaxed text-faint">{data.privacyNotice}</p>
            </Panel>
          </div>

          <div className="space-y-2.5">
            <Panel title="Location" icon={<MapPin size={12} />} flush>
              <div className="h-[300px]">
                <MapView
                  mode="points"
                  accidents={feature}
                  network={network.data}
                  basemap="night"
                  toggles={{ roads: true, districts: true, water: true, parks: true, intersections: false }}
                  selectedPublicId={data.publicId}
                  fitBounds={[[data.lng - 0.015, data.lat - 0.01], [data.lng + 0.015, data.lat + 0.01]]}
                  fitNonce={1}
                  legend={[{ label: "Reported location", color: "#2dd4bf" }]}
                  onSelectAccident={() => undefined}
                />
              </div>
              <div className="border-t border-line px-2 py-1.5">
                <SectionLabel>coordinates</SectionLabel>
                <div className="mono text-[11px] text-ink">{data.lat.toFixed(5)}, {data.lng.toFixed(5)}</div>
                <div className="text-[10px] text-faint">Uncertainty envelope ±{data.positionalUncertaintyM.toFixed(0)} m — interpret proximity accordingly.</div>
              </div>
            </Panel>
            <Panel title="What next?" icon={<FileSearch size={12} />}>
              <ul className="list-disc space-y-1 pl-3.5 text-[10.5px] leading-relaxed text-muted">
                <li>Moderators review pending reports in the administration console and can verify, reject or merge duplicates.</li>
                <li>If your report duplicates an existing record, it will be linked rather than deleted, preserving the audit trail.</li>
                <li>Verified records feed analytics, spatial statistics and the relative risk index.</li>
              </ul>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
