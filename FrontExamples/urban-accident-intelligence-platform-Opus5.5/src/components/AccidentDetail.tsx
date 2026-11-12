"use client";
import { useEffect, useState } from "react";
import { api, fmt } from "@/lib/client/api";
import { useApp } from "./providers";
import { Badge, KV, Notice, Spinner } from "./ui";

export interface AccidentDetailData {
  id: number;
  trackingCode: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
  category: string;
  severity: string;
  vehicles: number;
  description: string;
  emergencyServices: boolean;
  reportedLon: number;
  reportedLat: number;
  lon: number;
  lat: number;
  snapDistanceM: number | null;
  qualityFlags: string[];
  weather: string | null;
  lightCondition: string | null;
  isSynthetic: boolean;
  duplicateScore: number | null;
  dataset: { code: string; name: string; kind: string };
  segment: { id: number; name: string; roadClass: string; speedLimit: number; lit: boolean; lanes: number; aadt: number | null } | null;
  attachments: { id: number; fileName: string; mimeType: string; sizeBytes: number }[];
  duplicateOf: { id: number; trackingCode: string; occurredAt: string; status: string; category?: string; severity?: string } | null;
  history: { id: number; action: string; previousStatus: string; newStatus: string; note: string; createdAt: string; reviewer: string | null }[];
  syntheticTruth?: { kind: string; component?: string } | null;
  hasContact?: boolean;
}

export function StatusBadge({ status }: { status: string }) {
  const { meta } = useApp();
  const s = meta?.statuses.find((x) => x.code === status);
  return <Badge color={s?.color ?? "#999"}>{status === "reported" ? "unverified" : status}</Badge>;
}

export function AccidentDetail({ id, onData, reloadKey }: { id: number; onData?: (d: AccidentDetailData) => void; reloadKey?: number }) {
  const { meta } = useApp();
  const [d, setD] = useState<AccidentDetailData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cb = onData;
  useEffect(() => {
    let alive = true;
    setErr(null);
    api<AccidentDetailData>(`/api/accidents/${id}`)
      .then((r) => {
        if (!alive) return;
        setD(r);
        cb?.(r);
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, reloadKey]);
  if (err) return <Notice tone="danger">{err}</Notice>;
  if (!d || d.id !== id) return <Spinner label="Loading incident…" />;
  const cat = meta?.categories.find((c) => c.code === d.category);
  const sev = meta?.severities.find((s) => s.code === d.severity);
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="num text-[13px] font-semibold">{d.trackingCode}</span>
        <StatusBadge status={d.status} />
        {d.isSynthetic && <Badge color="#f5a524">synthetic</Badge>}
      </div>
      {d.status === "reported" && <Notice tone="warn">Unverified citizen report — not treated as a confirmed accident in analyses by default.</Notice>}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge color={sev?.color}>{sev?.label}</Badge>
        <Badge color={cat?.color}>{cat?.label}</Badge>
      </div>
      <p className="text-[12px] text-muted leading-snug">{d.description || "—"}</p>
      <div>
        <KV k="Occurred (local)" v={fmt.dt(d.occurredAt)} />
        <KV k="Reported" v={fmt.dt(d.reportedAt)} />
        <KV k="Reporting delay" v={`${fmt.dec((Date.parse(d.reportedAt) - Date.parse(d.occurredAt)) / 3600000, 1)} h`} />
        <KV k="Vehicles" v={d.vehicles} />
        <KV k="Emergency services" v={d.emergencyServices ? "yes" : "no"} />
        <KV k="Weather (linked)" v={d.weather ?? "—"} />
        <KV k="Light condition" v={d.lightCondition ?? "—"} />
        <KV k="Road segment" v={d.segment ? `${d.segment.name} #${d.segment.id}` : "unassigned"} />
        {d.segment && <KV k="Road attributes" v={`${d.segment.roadClass}, ${d.segment.speedLimit} km/h, ${d.segment.lit ? "lit" : "unlit"}`} />}
        <KV k="Snap distance" v={d.snapDistanceM === null ? "—" : `${fmt.dec(d.snapDistanceM, 1)} m`} />
        <KV k="Reported coord." v={`${d.reportedLat.toFixed(6)}, ${d.reportedLon.toFixed(6)}`} />
        <KV k="Validated coord." v={`${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}`} />
        <KV k="Dataset" v={d.dataset.code} />
      </div>
      {d.qualityFlags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {d.qualityFlags.map((f) => (
            <Badge key={f} color="#f5a524">
              {f.replace(/_/g, " ")}
            </Badge>
          ))}
        </div>
      )}
      {d.duplicateOf && (
        <Notice tone="warn">
          Possible duplicate of <span className="num font-medium">{d.duplicateOf.trackingCode}</span> ({fmt.dt(d.duplicateOf.occurredAt)}, {d.duplicateOf.status}); similarity score {fmt.dec(d.duplicateScore, 2)}.
        </Notice>
      )}
      {d.syntheticTruth && (
        <div className="text-[11px] text-faint">
          Generator ground truth: <span className="num">{d.syntheticTruth.kind}</span>
          {d.syntheticTruth.component ? ` · ${d.syntheticTruth.component}` : ""}
        </div>
      )}
      {d.attachments.length > 0 && (
        <div>
          <div className="label mb-1">Attachments ({d.attachments.length})</div>
          {d.history !== undefined && d.hasContact !== undefined ? (
            <div className="grid grid-cols-3 gap-1">
              {d.attachments.map((a) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={a.id} href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer"><img src={`/api/attachments/${a.id}`} alt={a.fileName} className="aspect-square object-cover rounded-[3px] border border-line" /></a>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-faint">Photos are visible to administrators only.</p>
          )}
        </div>
      )}
      {d.history.length > 0 && (
        <div>
          <div className="label mb-1">Review history</div>
          {d.history.map((h) => (
            <div key={h.id} className="text-[11.5px] border-l-2 border-line pl-2 mb-1">
              <span className="text-fg">{h.action}</span> <span className="text-faint">{h.previousStatus} → {h.newStatus}</span> · {h.reviewer ?? "system"} · {fmt.dt(h.createdAt)}
              {h.note && <div className="text-muted">{h.note}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
