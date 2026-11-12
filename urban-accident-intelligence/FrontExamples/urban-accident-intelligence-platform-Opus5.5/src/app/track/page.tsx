"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { StatusBadge } from "@/components/AccidentDetail";
import { Button, KV, Notice } from "@/components/ui";
import { api, fmt } from "@/lib/client/api";

interface Track {
  trackingCode: string;
  status: string;
  occurredAt: string;
  reportedAt: string;
  updatedAt: string;
  category: string;
  severity: string;
  flags: string[];
  history: { action: string; newStatus: string; createdAt: string }[];
}

const STATUS_TEXT: Record<string, string> = {
  reported: "Received — awaiting review by an administrator. Not yet used in analyses.",
  verified: "Verified — included in road-safety analyses.",
  rejected: "Rejected — the report could not be corroborated or was invalid.",
  duplicate: "Merged — identified as a duplicate of another report of the same incident.",
};

function TrackInner() {
  const sp = useSearchParams();
  const [code, setCode] = useState(sp.get("code") ?? "");
  const [data, setData] = useState<Track | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lookup = useCallback(async (c: string) => {
    if (!c.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      setData(await api<Track>(`/api/track/${encodeURIComponent(c.trim())}`));
    } catch (e) {
      setData(null);
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const c = sp.get("code");
    if (c) void lookup(c);
  }, [sp, lookup]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-xl mx-auto p-6 space-y-4">
        <div>
          <h1 className="text-[16px] font-semibold">Track a report</h1>
          <p className="text-[12px] text-muted">Enter the tracking code you received after submitting. Only non-personal status information is shown.</p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void lookup(code);
          }}
        >
          <input className="field num uppercase" placeholder="UAI-XXXXXXXXXX" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button variant="primary" loading={loading} type="submit">
            Look up
          </Button>
        </form>
        {err && <Notice tone="danger">{err}</Notice>}
        {data && (
          <div className="border border-line bg-panel rounded-[4px] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="num font-semibold text-[15px]">{data.trackingCode}</span>
              <StatusBadge status={data.status} />
            </div>
            <p className="text-[12.5px]">{STATUS_TEXT[data.status]}</p>
            <div>
              <KV k="Incident time" v={fmt.dt(data.occurredAt)} />
              <KV k="Submitted" v={fmt.dt(data.reportedAt)} />
              <KV k="Last update" v={fmt.dt(data.updatedAt)} />
              <KV k="Type / severity" v={`${data.category} / ${data.severity}`} />
            </div>
            <div>
              <div className="label mb-1">Timeline</div>
              <ol className="border-l border-line ml-1 space-y-1.5">
                <li className="pl-3 text-[12px]">
                  <span className="text-fg">submitted</span> <span className="text-faint">{fmt.dt(data.reportedAt)}</span>
                </li>
                {data.history
                  .slice()
                  .reverse()
                  .map((h, i) => (
                    <li key={i} className="pl-3 text-[12px]">
                      <span className="text-fg">{h.action.replace("_", " ")}</span> → {h.newStatus} <span className="text-faint">{fmt.dt(h.createdAt)}</span>
                    </li>
                  ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TrackPage() {
  return (
    <Suspense fallback={null}>
      <TrackInner />
    </Suspense>
  );
}
